import { useState } from "react";
import { Buffer } from "buffer";
import {
    buildTransferInput,
} from "@shieldpass/sdk/dist/circuitInputs";
import {
    prove,
} from "@shieldpass/sdk/dist/groth16Prover";
import {
    ownerOf,
    noteCommitment,
    type Compliance,
} from "@shieldpass/sdk/dist/notes";
import {
    encryptNote,
    decodeAddress,
    randomField,
} from "@shieldpass/sdk/dist/identity";
import { api } from "./api";
import { useSession, type ShieldedNote } from "./session";
import { assetByCode } from "./assets";
import { useInsertProof } from "./useInsertProof";

const buf = (u8: Uint8Array): Buffer => Buffer.from(u8);
const hex = (u8: Uint8Array) => Array.from(u8).map((b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (s: string) => Uint8Array.from(s.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
const fieldDec = (u8: Uint8Array) => BigInt("0x" + Buffer.from(u8).toString("hex")).toString();

export type TransferStatus = "idle" | "resolving" | "fetching-path" | "loading-circuit" | "generating" | "submitting" | "done" | "error";

export function useShieldedTransfer(apiBaseUrl: string) {
    const session = useSession();
    const { insertProof } = useInsertProof();
    const [status, setStatus] = useState<TransferStatus>("idle");
    const [error, setError] = useState<string | null>(null);

    /** Resolve a recipient (shp_ address or email) -> { owner, encPub }. */
    async function resolveRecipient(recipient: string): Promise<{ owner: bigint; encPub: Uint8Array }> {
        const r = recipient.trim();
        if (r.startsWith("shp_")) {
            const { owner, encPublic } = decodeAddress(r);
            return { owner, encPub: encPublic };
        }
        const id = await api.lookupShielded(r); // by email
        return { owner: BigInt(id.owner), encPub: fromHex(id.encPub) };
    }

    const send = async (recipient: string, sendAmount: bigint, assetCode?: string): Promise<string | null> => {
        setError(null);
        try {
            if (!session.identity) throw new Error("Shielded key locked — unlock it to send privately.");
            if (!session.wallet || !session.address) throw new Error("Wallet not connected.");
            const asset = assetByCode(assetCode ?? session.notes[0]?.asset ?? "XLM");
            if (!asset) throw new Error("Asset is not configured.");
            const sk = session.identity.sk;

            const note = session.notes.find((n) => n.asset === asset.code && BigInt(n.amount) >= sendAmount);
            if (!note) throw new Error(`No single shielded ${asset.code} note covers this amount.`);
            const compliance: Compliance = {
                hardware_attested: BigInt(note.compliance.hardware_attested),
                bvn_verified: BigInt(note.compliance.bvn_verified),
                good_standing: BigInt(note.compliance.good_standing),
            };

            setStatus("resolving");
            const { owner: recipient_owner, encPub } = await resolveRecipient(recipient);

            setStatus("fetching-path");
            // Pool-scoped: the membership path must come from THIS asset's tree.
            const res = await fetch(`${apiBaseUrl}/tree/path/${note.leafIndex}?pool=${encodeURIComponent(asset.poolContractId)}`);
            if (!res.ok) throw new Error("Could not fetch membership path.");
            const { siblings, indices, root } = await res.json();

            const recipient_randomness = randomField();
            const change_randomness = randomField();
            const input = buildTransferInput({
                sk, in_amount: BigInt(note.amount), in_randomness: BigInt(note.randomness),
                compliance, siblings: (siblings as string[]).map(BigInt), indices: (indices as string[]).map(Number),
                merkle_root: BigInt(root), send_amount: sendAmount, recipient_owner,
                recipient_randomness, change_randomness,
            });

            setStatus("loading-circuit");
            const [wasm, zkey] = await Promise.all([
                fetch("/shielded_transfer.wasm").then((r) => r.arrayBuffer()).then((b) => new Uint8Array(b)),
                fetch("/shielded_transfer_final.zkey").then((r) => r.arrayBuffer()).then((b) => new Uint8Array(b)),
            ]);
            setStatus("generating");
            const bundle = await prove(input, wasm, zkey);
            // publicSignals = [nullifier, out_recipient, out_change, root, recipient_owner]
            const outRecipient = fieldDec(bundle.publicSignals[1]);
            const outChange = fieldDec(bundle.publicSignals[2]);

            setStatus("submitting");
            const transferRes = await session.wallet.invoke(asset.poolContractId, "shielded_transfer", {
                proof_a: buf(bundle.proof.a), proof_b: buf(bundle.proof.b), proof_c: buf(bundle.proof.c),
                public_signals: bundle.publicSignals.map(buf),
            });

            // Insert both output notes into the tree using client-side proving
            // (sequential to avoid racing the index counter).
            setStatus("submitting");
            const { index: recipientIndex } = await insertProof(outRecipient, (s) => setStatus(s as TransferStatus), asset.poolContractId);
            const { index: changeIndex } = await insertProof(outChange, (s) => setStatus(s as TransferStatus), asset.poolContractId);
            void recipientIndex;

            // deliver the encrypted note blob to the recipient
            const plaintext = new TextEncoder().encode(JSON.stringify({
                amount: sendAmount.toString(), randomness: recipient_randomness.toString(),
                compliance: note.compliance, asset: note.asset,
            }));
            const { ephemeralPublic, ciphertext } = encryptNote(encPub, plaintext);
            await api.postNoteBlob({ commitment: outRecipient, ephemeralPub: hex(ephemeralPublic), ciphertext: hex(ciphertext) });

            // update our balance: drop the spent note, add the change note
            const changeAmount = BigInt(note.amount) - sendAmount;
            const changeNotes: ShieldedNote[] = changeAmount > 0n ? [{
                amount: changeAmount.toString(), asset: note.asset, randomness: change_randomness.toString(),
                leafIndex: changeIndex, compliance: note.compliance,
                confirmed: true, // insertProof above already landed the change leaf on-chain
            }] : [];

            // Deliver a SELF-addressed blob for the change note too, so our own balance is
            // recoverable from the blob store after a logout/wipe or on a new device. Without
            // this, change notes live only in localStorage and are lost when the session is reset.
            if (changeAmount > 0n) {
                const changePlain = new TextEncoder().encode(JSON.stringify({
                    amount: changeAmount.toString(), randomness: change_randomness.toString(),
                    compliance: note.compliance, asset: note.asset,
                }));
                const enc = encryptNote(session.identity.encPublic, changePlain);
                await api.postNoteBlob({ commitment: outChange, ephemeralPub: hex(enc.ephemeralPublic), ciphertext: hex(enc.ciphertext) });
            }

            session.set({ notes: [...session.notes.filter((n) => n !== note), ...changeNotes] });

            // sanity: the recipient commitment we delivered must match the proof output
            const expect = noteCommitment(sendAmount, recipient_owner, recipient_randomness, compliance);
            if (expect.toString() !== outRecipient) throw new Error("internal: recipient commitment mismatch");
            void ownerOf;

            setStatus("done");
            return transferRes.hash;
        } catch (err: any) {
            console.error("[useShieldedTransfer]", err);
            setError(err?.message || "transfer failed");
            setStatus("error");
            return null;
        }
    };

    return { status, error, send };
}
