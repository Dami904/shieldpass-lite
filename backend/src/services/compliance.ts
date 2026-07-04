import { ShieldPassProver, hexToProof } from '@shieldpass/sdk';
import kycCircuit from '@shieldpass/sdk/dist/reusable_kyc.json';
import { prisma } from '../db';

const prover = new ShieldPassProver(kycCircuit as any);
let ready: Promise<void> | undefined;
function ensureProver(): Promise<void> { if (!ready) ready = prover.init(); return ready!; }

export interface ProofInput { proof: string; publicInputs: string[]; nullifier: string; }
export type CheckResult = { ok: true } | { ok: false; status: number; error: string };

/** Replay-check then cryptographically verify a compliance proof. Does NOT burn the nullifier. */
export async function checkProof(input: ProofInput): Promise<CheckResult> {
  const spent = await prisma.nullifier.findUnique({ where: { value: input.nullifier ?? '' } });
  if (spent) return { ok: false, status: 409, error: 'This compliance proof has already been used (nullifier spent).' };
  try {
    await ensureProver();
    const valid = await prover.verifyProof(hexToProof(input.proof), input.publicInputs);
    if (!valid) return { ok: false, status: 400, error: 'Invalid Zero-Knowledge Proof.' };
  } catch {
    return { ok: false, status: 400, error: 'Invalid Zero-Knowledge Proof.' };
  }
  return { ok: true };
}

/** Burn a nullifier so the proof can never be reused. Call only after the gated action succeeds. */
export async function burnNullifier(nullifier: string, walletAddress: string, action: string): Promise<void> {
  await prisma.nullifier.create({ data: { value: String(nullifier), walletAddress, action } });
}
