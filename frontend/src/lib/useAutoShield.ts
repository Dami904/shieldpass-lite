import { useEffect, useRef, useState } from "react";
import { Buffer } from "buffer";
import { fieldToBytes32 } from "@shieldpass/sdk/dist/groth16Prover";
import { noteCommitment, type Compliance } from "@shieldpass/sdk/dist/notes";
import { encryptNote } from "@shieldpass/sdk/dist/identity";
import { api } from "./api";
import type { Session } from "./session";
import { SUPPORTED_ASSETS, formatUnits, type SupportedAsset } from "./assets";

const RPC_URL = import.meta.env.VITE_RPC_URL || "https://soroban-testnet.stellar.org";
const POLL_MS = 20_000;

const buf = (u8: Uint8Array): Buffer => Buffer.from(u8);

function randomField(): string {
  const bytes = new Uint8Array(31);
  crypto.getRandomValues(bytes);
  let hex = "0x";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return BigInt(hex).toString();
}

type InsertProofFn = (commitment: string, setStatus?: (s: string) => void, pool?: string) => Promise<{ index: number }>;

// Ported from the old DepositPage's handleShield — the only difference is this runs
// unattended (triggered by a detected wallet balance) instead of from a form submit.
async function shieldDeposit(
  session: Session,
  insertProof: InsertProofFn,
  asset: SupportedAsset,
  amt: bigint,
  setStatus: (s: string) => void,
) {
  if (!session.identity) throw new Error("Shielded key locked — unlock it to auto-shield funds.");
  const compliance: Compliance = {
    hardware_attested: 1n,
    bvn_verified: session.bvnVerified ? 1n : 0n,
    good_standing: 1n,
  };
  const randomness = randomField();
  const commitment = noteCommitment(amt, session.identity.owner, BigInt(randomness), compliance);

  setStatus(`Approve auto-shielding ${formatUnits(amt, asset.decimals, 4)} ${asset.code} on your device…`);
  const depositRes = await session.wallet!.invoke(asset.poolContractId, "deposit", {
    user: session.address,
    amount: amt,
    note_commitment: buf(fieldToBytes32(commitment)),
  });

  setStatus("Updating your shielded balance…");
  const { index: leafIndex } = await insertProof(commitment.toString(), setStatus, asset.poolContractId);

  const noteCompliance = { hardware_attested: "1", bvn_verified: session.bvnVerified ? "1" : "0", good_standing: "1" };
  session.set({
    notes: [...session.notes, {
      amount: amt.toString(), asset: asset.code, randomness, leafIndex,
      compliance: noteCompliance,
      confirmed: true,
    }],
  });

  // Self-addressed recovery blob, same as every other note-creating flow — without it this
  // note would only live in localStorage and vanish on logout / a new device.
  try {
    const plaintext = new TextEncoder().encode(JSON.stringify({
      amount: amt.toString(), randomness, compliance: noteCompliance, asset: asset.code,
    }));
    const enc = encryptNote(session.identity.encPublic, plaintext);
    await api.postNoteBlob({
      commitment: commitment.toString(),
      ephemeralPub: Buffer.from(enc.ephemeralPublic).toString("hex"),
      ciphertext: Buffer.from(enc.ciphertext).toString("hex"),
    });
  } catch (e) {
    console.warn("[auto-shield] recovery blob publish failed (note still usable this session):", e);
  }

  api.notify({
    email: session.email, type: "SHIELD", title: "Auto-shielded incoming funds",
    amount: formatUnits(amt, asset.decimals, 4), asset: asset.code, txHash: depositRes.hash,
  }).catch(() => {});
}

/**
 * Lite has no manual "Shield" button — any XLM/USDC that lands in the public wallet is shielded
 * automatically. This polls the wallet's public balance for each configured asset and, if it
 * finds anything sitting there, runs the same deposit-into-pool flow the old DepositPage used —
 * triggering one passkey (WebAuthn) confirmation per detected deposit, with no other UI step.
 */
export function useAutoShield(session: Session, insertProof: InsertProofFn) {
  const [status, setStatus] = useState<string | null>(null);
  const runningRef = useRef(false);

  useEffect(() => {
    if (!session.address || !session.wallet || !session.identity) return;

    let cancelled = false;

    async function checkAndShieldOnce() {
      if (runningRef.current || cancelled) return;
      runningRef.current = true;
      try {
        const { StellarContractClient } = await import("@shieldpass/sdk/dist/stellar");
        const { Networks } = await import("@stellar/stellar-sdk");

        for (const asset of SUPPORTED_ASSETS) {
          if (cancelled) break;
          let raw: bigint;
          try {
            const client = new StellarContractClient(RPC_URL, Networks.TESTNET, asset.sac);
            raw = await client.getTokenBalance(asset.sac, session.address!);
          } catch {
            continue; // balance read failed — try again next poll
          }
          if (raw <= 0n) continue;

          try {
            await shieldDeposit(session, insertProof, asset, raw, setStatus);
          } catch (err) {
            console.warn(`[auto-shield] failed to shield ${asset.code}:`, err);
            // Leave it in the public wallet — the next poll retries.
          }
        }
      } finally {
        setStatus(null);
        runningRef.current = false;
      }
    }

    checkAndShieldOnce();
    const interval = setInterval(checkAndShieldOnce, POLL_MS);
    return () => { cancelled = true; clearInterval(interval); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.address, session.wallet, session.identity]);

  return { autoShieldStatus: status };
}
