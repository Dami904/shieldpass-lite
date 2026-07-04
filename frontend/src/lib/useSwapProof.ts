import { useState } from 'react';
import {
    buildSwapInputFromPath,
} from '@shieldpass/sdk/dist/circuitInputs';
import {
    fieldToBytes32,
    prove,
    serializeProof,
    type SerializedProof,
} from '@shieldpass/sdk/dist/groth16Prover';
import {
    noteCommitment,
    ownerOf,
    type Compliance,
} from '@shieldpass/sdk/dist/notes';
import { randomField } from '@shieldpass/sdk/dist/identity';
import { useSession, type ShieldedNote } from './session';
import { assetByCode } from './assets';

export type SwapProofStatus = 'idle' | 'fetching-path' | 'loading-circuit' | 'generating' | 'done' | 'error';

export type { ShieldedNote };

export interface SwapProofResult {
    proof: SerializedProof;            // a/b/c bytes for confidential_swap
    publicSignals: Uint8Array[];       // [nullifier, change, bank, root, require_bvn, swap_amount]
    refundCommitment: Uint8Array;      // pre-committed note to reclaim on timeout
    changeNote: { amount: string; randomness: string };
    refundNote: { amount: string; randomness: string };
    nullifier: string;
}

/**
 * In-browser confidential-swap proving (Groth16/BN254), owner-based model. Spends a note
 * owned by the user's shielded key (session.identity.sk). The contract verifies the proof.
 */
export function useSwapProof(apiBaseUrl: string) {
    const session = useSession();
    const [status, setStatus] = useState<SwapProofStatus>('idle');
    const [error, setError] = useState<string | null>(null);

    const generate = async (
        note: ShieldedNote,
        swapAmount: bigint,
        bank: { accountNumber: bigint; salt: bigint },
        requireBvn: boolean,
        // Destination binding. For unshield, pass addressToField(recipientAddress) so the
        // proof commits to the on-chain recipient and a relayer can't redirect it. For
        // withdraw-to-fiat leave 0 (bound by the bank hash instead).
        recipientField: bigint = 0n,
    ): Promise<SwapProofResult | null> => {
        setError(null);
        try {
            if (!session.identity) throw new Error('Shielded key locked — unlock it to spend private funds.');
            const sk = session.identity.sk;
            const compliance: Compliance = {
                hardware_attested: BigInt(note.compliance.hardware_attested),
                bvn_verified: BigInt(note.compliance.bvn_verified),
                good_standing: BigInt(note.compliance.good_standing),
            };

            // 1. membership path from the indexer — scoped to THIS asset's pool/tree.
            setStatus('fetching-path');
            const pool = assetByCode(note.asset)?.poolContractId;
            const pathUrl = `${apiBaseUrl}/tree/path/${note.leafIndex}${pool ? `?pool=${encodeURIComponent(pool)}` : ''}`;
            const res = await fetch(pathUrl);
            if (!res.ok) throw new Error('Could not fetch membership path from the tree indexer.');
            const { siblings, indices, root } = await res.json();

            // 2. build witness (owner-based)
            const changeRandomness = randomField();
            const input = buildSwapInputFromPath({
                sk,
                in_amount: BigInt(note.amount),
                in_randomness: BigInt(note.randomness),
                compliance,
                siblings: (siblings as string[]).map(BigInt),
                indices: (indices as string[]).map(Number),
                merkle_root: BigInt(root),
                swap_amount: swapAmount,
                change_randomness: changeRandomness,
                bank_account_number: bank.accountNumber,
                secret_salt: bank.salt,
                require_bvn: requireBvn ? 1n : 0n,
                recipient: recipientField,
            });

            // 3. fetch circuit artifacts + prove
            setStatus('loading-circuit');
            const [wasm, zkey] = await Promise.all([
                fetch('/confidential_swap.wasm').then((r) => r.arrayBuffer()).then((b) => new Uint8Array(b)),
                fetch('/confidential_swap_final.zkey').then((r) => r.arrayBuffer()).then((b) => new Uint8Array(b)),
            ]);
            setStatus('generating');
            const bundle = await prove(input, wasm, zkey);

            // 4. pre-commit a refund note (owned by the user) for swap_amount
            const refundRandomness = randomField();
            const refundCommitmentField = noteCommitment(swapAmount, ownerOf(sk), refundRandomness, compliance);

            setStatus('done');
            return {
                proof: bundle.proof,
                publicSignals: bundle.publicSignals,
                refundCommitment: fieldToBytes32(refundCommitmentField),
                changeNote: { amount: (BigInt(note.amount) - swapAmount).toString(), randomness: changeRandomness.toString() },
                refundNote: { amount: swapAmount.toString(), randomness: refundRandomness.toString() },
                nullifier: bundle.raw.publicSignals[0],
            };
        } catch (err: any) {
            console.error('[useSwapProof]', err);
            setError(err?.message || 'proof generation failed');
            setStatus('error');
            return null;
        }
    };

    return { status, error, generate, serializeProof };
}
