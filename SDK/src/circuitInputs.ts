import { IncrementalMerkleTree } from './tree';
import { Compliance } from './notes';

const DEPTH = 20;

function indexBits(index: number): string[] {
    const bits: string[] = [];
    let idx = index;
    for (let i = 0; i < DEPTH; i++) { bits.push(String(idx & 1)); idx = Math.floor(idx / 2); }
    return bits;
}

// ---- confidential_swap (withdraw / unshield) — owner-based ----

export interface SwapWitnessFromPath {
    sk: bigint;                // shielded spending key
    in_amount: bigint;
    in_randomness: bigint;
    compliance: Compliance;
    siblings: bigint[];        // from the tree indexer (GET /tree/path/:index)
    indices: number[];
    merkle_root: bigint;
    swap_amount: bigint;       // public — value leaving the pool
    change_randomness: bigint;
    bank_account_number: bigint;
    secret_salt: bigint;
    require_bvn: bigint;
    // Destination binding. For unshield, pass addressToField(recipientAddress) so the
    // contract can verify the on-chain recipient matches the proof. For withdraw-to-fiat
    // leave 0 (that flow is bound by the blinded bank hash instead).
    recipient?: bigint;
}

export function buildSwapInputFromPath(w: SwapWitnessFromPath): Record<string, unknown> {
    return {
        sk: w.sk.toString(),
        in_amount: w.in_amount.toString(),
        in_randomness: w.in_randomness.toString(),
        merkle_path: w.siblings.map(String),
        merkle_indices: w.indices.map(String),
        change_randomness: w.change_randomness.toString(),
        bank_account_number: w.bank_account_number.toString(),
        secret_salt: w.secret_salt.toString(),
        hardware_attested: w.compliance.hardware_attested.toString(),
        bvn_verified: w.compliance.bvn_verified.toString(),
        good_standing: w.compliance.good_standing.toString(),
        merkle_root: w.merkle_root.toString(),
        require_bvn: w.require_bvn.toString(),
        swap_amount: w.swap_amount.toString(),
        recipient: (w.recipient ?? 0n).toString(),
    };
}

// ---- shielded_transfer (private P2P) ----

export interface TransferWitnessFromPath {
    sk: bigint;
    in_amount: bigint;
    in_randomness: bigint;
    compliance: Compliance;
    siblings: bigint[];
    indices: number[];
    merkle_root: bigint;
    send_amount: bigint;        // hidden
    recipient_owner: bigint;    // public — bound
    recipient_randomness: bigint;
    change_randomness: bigint;
}

export function buildTransferInput(w: TransferWitnessFromPath): Record<string, unknown> {
    return {
        sk: w.sk.toString(),
        in_amount: w.in_amount.toString(),
        in_randomness: w.in_randomness.toString(),
        hw: w.compliance.hardware_attested.toString(),
        bvn: w.compliance.bvn_verified.toString(),
        standing: w.compliance.good_standing.toString(),
        merkle_path: w.siblings.map(String),
        merkle_indices: w.indices.map(String),
        send_amount: w.send_amount.toString(),
        recipient_randomness: w.recipient_randomness.toString(),
        change_randomness: w.change_randomness.toString(),
        merkle_root: w.merkle_root.toString(),
        recipient_owner: w.recipient_owner.toString(),
    };
}

// ---- merkle_insert (unchanged) ----

/**
 * Append `leaf` to `tree` and build the input for the `merkle_insert` circuit proving
 * the resulting `old_root -> new_root` transition. Mutates the tree.
 */
export function buildInsertInput(tree: IncrementalMerkleTree, leaf: bigint): Record<string, unknown> {
    const a = tree.append(leaf);
    return {
        old_root: a.oldRoot.toString(),
        new_root: a.newRoot.toString(),
        leaf: leaf.toString(),
        index: String(a.index),
        siblings: a.siblings.map(String),
    };
}

export { indexBits };
