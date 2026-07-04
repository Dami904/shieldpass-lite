import { poseidon2, poseidon3, poseidon7 } from 'poseidon-lite';

// Domain-separation tags — MUST match note.circom.
export const DOM_NOTE = 1n;
export const DOM_NULL = 2n;
export const DOM_BANK = 3n;
export const DOM_OWNER = 4n;

export interface Compliance {
    hardware_attested: bigint; // 1
    bvn_verified: bigint;      // 0 | 1
    good_standing: bigint;     // 1
}

/** owner = Poseidon(DOM_OWNER, sk). Only the holder of `sk` can spend notes bound to this owner. */
export function ownerOf(sk: bigint): bigint {
    return poseidon2([DOM_OWNER, sk]);
}

/**
 * Note commitment = Poseidon(DOM_NOTE, amount, owner, randomness, hw, bvn, standing).
 * Owner-based: a sender can create a note FOR a recipient by binding the recipient's owner,
 * without being able to spend it back (they don't hold the recipient's sk).
 */
export function noteCommitment(amount: bigint, owner: bigint, randomness: bigint, c: Compliance): bigint {
    return poseidon7([DOM_NOTE, amount, owner, randomness, c.hardware_attested, c.bvn_verified, c.good_standing]);
}

/** Nullifier = Poseidon(DOM_NULL, sk, leaf). Unique per (key, note); prevents double-spend. */
export function noteNullifier(sk: bigint, leaf: bigint): bigint {
    return poseidon3([DOM_NULL, sk, leaf]);
}

/** Blinded bank commitment = Poseidon(DOM_BANK, account_number, salt). */
export function blindedBankCommitment(accountNumber: bigint, salt: bigint): bigint {
    return poseidon3([DOM_BANK, accountNumber, salt]);
}
