/**
 * ShieldPass Issuer Service
 * Responsible for generating the KYC leaf commitment and Merkle path
 * for a user who has passed identity verification.
 *
 * Uses the shared Poseidon (BN254) module so every commitment/root it
 * produces satisfies the Noir circuit's assertions. See poseidon.ts.
 */
import { randomBytes } from 'crypto';
import { computeLeaf, computeMerkleRoot } from './poseidon';

export const DEPTH = 8; // Must match `global DEPTH: u32 = 8` in main.nr

export interface MerkleProof {
    merkle_path: string[];
    merkle_indices: string[];
    merkle_root: string;
}

export class TrustedIssuer {
    /**
     * Generates a leaf commitment by hashing the user's private attributes,
     * exactly as the circuit reconstructs it:
     *   leaf = poseidon4([secret_salt, hardware_attested, bvn_verified, good_standing])
     */
    generateLeaf(secretSalt: bigint, hardwareAttested: boolean, bvnVerified: boolean, goodStanding: boolean): string {
        if (typeof secretSalt !== 'bigint') throw new Error('secretSalt must be a bigint');
        return computeLeaf(secretSalt, hardwareAttested ? 1 : 0, bvnVerified ? 1 : 0, goodStanding ? 1 : 0);
    }

    /**
     * Builds a single-leaf Merkle inclusion proof whose root is computed with the
     * SAME Poseidon used by the circuit, so the resulting proof actually verifies.
     *
     * For the hackathon the user sits at the leftmost slot with all-zero siblings;
     * the root is the real Poseidon fold of that path (NOT a placeholder `0`).
     * In production this returns the genuine inclusion path from the off-chain tree.
     */
    generateMerkleProof(leaf: string): MerkleProof {
        if (!leaf || leaf.length === 0) throw new Error('Leaf commitment is required');

        const merkle_path = Array(DEPTH).fill('0');
        const merkle_indices = Array(DEPTH).fill('0');
        const merkle_root = computeMerkleRoot(leaf, merkle_path, merkle_indices);

        return { merkle_path, merkle_indices, merkle_root };
    }

    /**
     * Generates a fresh cryptographically-random secret salt for a new user.
     * Returned to the user ONCE and never stored server-side.
     */
    generateSecretSalt(): string {
        const buf = randomBytes(31); // < BN254 field size, always a valid Field element
        return BigInt('0x' + buf.toString('hex')).toString();
    }
}
