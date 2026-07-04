import { poseidon2 } from 'poseidon-lite';

/**
 * Incremental append-only Merkle tree (Poseidon arity-2, ZERO leaf = 0n), matching
 * the on-chain tree and the Circom `merkle_insert` / `confidential_swap` circuits.
 * DEPTH must equal the circuit's DEPTH (20). This is the SDK's source of truth for
 * roots and the sibling paths fed to the prover.
 */
export class IncrementalMerkleTree {
    readonly depth: number;
    private zeros: bigint[] = [];
    private nodes = new Map<string, bigint>();
    private count = 0;

    constructor(depth = 20) {
        this.depth = depth;
        this.zeros = [0n];
        for (let i = 0; i < depth; i++) this.zeros.push(poseidon2([this.zeros[i], this.zeros[i]]));
    }

    private node(level: number, idx: number): bigint {
        const k = `${level}:${idx}`;
        return this.nodes.has(k) ? this.nodes.get(k)! : this.zeros[level];
    }

    get nextIndex(): number { return this.count; }
    root(): bigint { return this.node(this.depth, 0); }

    /** Sibling hashes from leaf `index` up to the root, in the CURRENT tree. */
    path(index: number): bigint[] {
        const siblings: bigint[] = [];
        let idx = index;
        for (let level = 0; level < this.depth; level++) {
            siblings.push(idx % 2 === 0 ? this.node(level, idx + 1) : this.node(level, idx - 1));
            idx = Math.floor(idx / 2);
        }
        return siblings;
    }

    /** Set a leaf and recompute the path to the root. */
    setLeaf(index: number, value: bigint): void {
        this.nodes.set(`0:${index}`, value);
        let idx = index;
        for (let level = 0; level < this.depth; level++) {
            const parent = Math.floor(idx / 2);
            const left = this.node(level, parent * 2);
            const right = this.node(level, parent * 2 + 1);
            this.nodes.set(`${level + 1}:${parent}`, poseidon2([left, right]));
            idx = parent;
        }
    }

    /**
     * Append `leaf` at the next free index, returning the witness needed to build a
     * `merkle_insert` proof (old_root before, new_root after, siblings, index).
     */
    append(leaf: bigint): { index: number; oldRoot: bigint; newRoot: bigint; siblings: bigint[] } {
        const index = this.count;
        const oldRoot = this.root();
        const siblings = this.path(index);
        this.setLeaf(index, leaf);
        this.count += 1;
        return { index, oldRoot, newRoot: this.root(), siblings };
    }
}
