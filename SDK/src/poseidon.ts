
/**
 * ShieldPass — Poseidon (BN254) hashing
 *
 * SINGLE SOURCE OF TRUTH for every hash used by the protocol.
 *
 * Verified to byte-for-byte match the circuit's `poseidon::poseidon::bn254`
 * (hash_2 / hash_4) — test.ts runs the full issuer → prover → verify round-trip
 * and asserts the proof verifies, which only happens if these hashes match.
 *
 * The issuer (tree building) and the prover (nullifier) MUST both use these
 * functions so the values they produce satisfy the circuit's assertions.
 */
import { poseidon2, poseidon4 } from 'poseidon-lite';

/** Anything that can be coerced to a BN254 field element. */
export type FieldLike = bigint | number | string;

function toField(x: FieldLike): bigint {
    if (typeof x === 'bigint') return x;
    if (typeof x === 'number') return BigInt(x);
    const s = x.trim();
    return s.startsWith('0x') ? BigInt(s) : BigInt(s);
}

/** Poseidon hash of two field elements — matches Noir `hash_2`. Returns a decimal string. */
export function hash2(a: FieldLike, b: FieldLike): string {
    return poseidon2([toField(a), toField(b)]).toString();
}

/** Poseidon hash of four field elements — matches Noir `hash_4`. Returns a decimal string. */
export function hash4(a: FieldLike, b: FieldLike, c: FieldLike, d: FieldLike): string {
    return poseidon4([toField(a), toField(b), toField(c), toField(d)]).toString();
}

/**
 * Reconstructs the KYC leaf commitment exactly as the circuit does:
 *   leaf = poseidon4([secret_salt, hardware_attested, bvn_verified, good_standing])
 */
export function computeLeaf(
    secretSalt: FieldLike,
    hardwareAttested: FieldLike = 1,
    bvnVerified: FieldLike = 0,
    goodStanding: FieldLike = 1,
): string {
    return hash4(secretSalt, hardwareAttested, bvnVerified, goodStanding);
}

/**
 * Folds a Merkle inclusion path into a root, matching `merkle_membership` in main.nr:
 *   index 0 => node is left  : poseidon2([node, sibling])
 *   index 1 => node is right : poseidon2([sibling, node])
 *
 * @param leaf    The leaf commitment (decimal/hex string or bigint)
 * @param path    DEPTH sibling hashes, leaf level first
 * @param indices DEPTH direction bits ('0' = left, '1' = right)
 */
export function computeMerkleRoot(leaf: FieldLike, path: FieldLike[], indices: FieldLike[]): string {
    if (path.length !== indices.length) {
        throw new Error('[poseidon] path and indices must be the same length.');
    }
    let node = toField(leaf);
    for (let i = 0; i < path.length; i++) {
        const sibling = toField(path[i]);
        const isRight = toField(indices[i]) === 1n;
        node = isRight ? toField(hash2(sibling, node)) : toField(hash2(node, sibling));
    }
    return node.toString();
}

/**
 * Computes the time-bound compliance nullifier, matching the circuit:
 *   nullifier = poseidon2([secret_salt, current_timestamp])
 */
export function computeNullifier(secretSalt: FieldLike, currentTimestamp: FieldLike): string {
    return hash2(secretSalt, currentTimestamp);
}
