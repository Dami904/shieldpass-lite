#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, token, Address, Bytes, BytesN, Env, U256, Vec,
};
use soroban_sdk::crypto::bn254::Fr;
use soroban_sdk::xdr::ToXdr;

pub mod groth16;
pub mod vk;

#[cfg(test)]
mod test_fixtures;
#[cfg(test)]
mod test;

use groth16::fr_from;

// Root of the empty depth-20 Poseidon(2) tree (computed off-chain with circomlib).
const ZERO_ROOT: [u8; 32] = [
    0x21, 0x34, 0xe7, 0x6a, 0xc5, 0xd2, 0x1a, 0xab, 0x18, 0x6c, 0x2b, 0xe1, 0xdd, 0x8f, 0x84, 0xee,
    0x88, 0x0a, 0x1e, 0x46, 0xea, 0xf7, 0x12, 0xf9, 0xd3, 0x71, 0xb6, 0xdf, 0x22, 0x19, 0x1f, 0x3e,
];

// BN254 scalar field order r — public signals must be canonical (< r).
const R_BE: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91, 0x43, 0xe1, 0xf5, 0x93, 0xf0, 0x00, 0x00, 0x01,
];

const REFUND_DELAY: u64 = 3600; // 1 hour

#[contracttype]
pub enum DataKey {
    Admin,
    Token,
    CurrentRoot,
    NextIndex,
    ValidRoot(BytesN<32>), // historical roots membership proofs may reference
    Nullifier(BytesN<32>), // spent set
    Pending(BytesN<32>),   // SET of commitments awaiting insertion (order-independent)
    SwapCounter,
    Payout(u64),
    Tier2Threshold,        // swap amounts >= this require a BVN (Tier 2) proof
}

#[contracttype]
#[derive(Clone, PartialEq)]
pub enum SwapStatus {
    Pending,
    Completed,
    Refunded,
}

#[contracttype]
#[derive(Clone)]
pub struct PayoutDetails {
    pub blinded_bank_hash: BytesN<32>,
    pub amount: i128,             // crypto released on claim (== proven swap_amount)
    pub refund_commitment: BytesN<32>, // user-pre-committed note to reclaim on timeout
    pub created: u64,
    pub status: SwapStatus,
}

#[contract]
pub struct ShieldedPool;

#[contractimpl]
impl ShieldedPool {
    pub fn init(env: Env, admin: Address, token_address: Address, tier2_threshold: i128) {
        let s = env.storage().instance();
        assert!(!s.has(&DataKey::Admin), "already initialized");
        s.set(&DataKey::Admin, &admin);
        s.set(&DataKey::Token, &token_address);
        s.set(&DataKey::NextIndex, &0u32);
        s.set(&DataKey::SwapCounter, &0u64);
        s.set(&DataKey::Tier2Threshold, &tier2_threshold);

        let zero = BytesN::from_array(&env, &ZERO_ROOT);
        s.set(&DataKey::CurrentRoot, &zero);
        env.storage().persistent().set(&DataKey::ValidRoot(zero), &true);
    }

    /// Public deposit: escrow crypto into the pool and queue its note commitment.
    pub fn deposit(env: Env, user: Address, amount: i128, note_commitment: BytesN<32>) {
        user.require_auth();
        let token_address: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        token::Client::new(&env, &token_address)
            .transfer(&user, &env.current_contract_address(), &amount);
        Self::enqueue(&env, note_commitment);
    }

    /// Faucet seed: queue a note commitment with no public transfer (funded from the pool).
    pub fn faucet_seed(env: Env, note_commitment: BytesN<32>) {
        Self::admin(&env).require_auth();
        Self::enqueue(&env, note_commitment);
    }

    /// Trustless tree append. Verifies a `merkle_insert` proof that appending the
    /// head pending commitment at `next_index` turns `current_root` into `new_root`.
    /// public signals = [old_root, new_root, leaf, index].
    pub fn insert(
        env: Env,
        proof_a: BytesN<64>,
        proof_b: BytesN<128>,
        proof_c: BytesN<64>,
        public_signals: Vec<BytesN<32>>,
    ) {
        assert!(public_signals.len() == 4, "insert: bad public signals");
        Self::require_canonical(&env, &public_signals);
        assert!(
            groth16::verify(&env, &vk::merkle_insert_vk(&env), &Self::g1(&env, &proof_a),
                &Self::g2(&env, &proof_b), &Self::g1(&env, &proof_c),
                &Self::to_fr_vec(&env, &public_signals)),
            "insert: invalid proof"
        );

        let old_root = public_signals.get(0).unwrap();
        let new_root = public_signals.get(1).unwrap();
        let leaf = public_signals.get(2).unwrap();
        let index_u32 = Self::to_u32(&public_signals.get(3).unwrap());

        let s = env.storage().instance();
        let current: BytesN<32> = s.get(&DataKey::CurrentRoot).unwrap();
        let next_index: u32 = s.get(&DataKey::NextIndex).unwrap();
        assert!(old_root == current, "insert: stale root");
        assert!(index_u32 == next_index, "insert: wrong index");

        // The appended leaf must be a genuinely-pending commitment — but ANY pending
        // commitment may be inserted, in any order (no FIFO), so concurrent users are safe.
        assert!(
            env.storage().persistent().has(&DataKey::Pending(leaf.clone())),
            "insert: leaf not pending"
        );
        env.storage().persistent().remove(&DataKey::Pending(leaf.clone()));

        s.set(&DataKey::CurrentRoot, &new_root);
        s.set(&DataKey::NextIndex, &(next_index + 1));
        env.storage().persistent().set(&DataKey::ValidRoot(new_root), &true);
    }

    /// Confidential swap: burn a note, mint a change note, queue a fiat payout.
    /// public signals = [nullifier, change_commitment, user_blinded_commitment,
    ///                    merkle_root, require_bvn, swap_amount].
    /// `refund_commitment` is a user-pre-committed note (for swap_amount) reclaimable
    /// on timeout if the fiat payout never settles — the trustless escape hatch.
    pub fn confidential_swap(
        env: Env,
        proof_a: BytesN<64>,
        proof_b: BytesN<128>,
        proof_c: BytesN<64>,
        public_signals: Vec<BytesN<32>>,
        refund_commitment: BytesN<32>,
    ) -> u64 {
        // 7 signals: [..., swap_amount, recipient]. The off-ramp ignores `recipient`
        // (signal [6]) — it is bound by the blinded bank hash, not an on-chain address.
        assert!(public_signals.len() == 7, "swap: bad public signals");
        Self::require_canonical(&env, &public_signals);
        assert!(
            groth16::verify(&env, &vk::confidential_swap_vk(&env), &Self::g1(&env, &proof_a),
                &Self::g2(&env, &proof_b), &Self::g1(&env, &proof_c),
                &Self::to_fr_vec(&env, &public_signals)),
            "swap: invalid proof"
        );

        let nullifier = public_signals.get(0).unwrap();
        let change_commitment = public_signals.get(1).unwrap();
        let blinded_bank_hash = public_signals.get(2).unwrap();
        let merkle_root = public_signals.get(3).unwrap();
        let require_bvn = Self::to_u32(&public_signals.get(4).unwrap());
        let amount = Self::to_i128(&public_signals.get(5).unwrap());

        // membership root must be one the contract has attested via insert()
        assert!(
            env.storage().persistent().has(&DataKey::ValidRoot(merkle_root)),
            "swap: unknown merkle root"
        );
        // double-spend protection
        assert!(
            !env.storage().persistent().has(&DataKey::Nullifier(nullifier.clone())),
            "swap: nullifier already spent"
        );
        // tier enforcement: high-value swaps must have used a BVN (Tier 2) proof
        let threshold: i128 = env.storage().instance().get(&DataKey::Tier2Threshold).unwrap();
        if amount >= threshold {
            assert!(require_bvn == 1, "swap: tier-2 amount requires BVN proof");
        }

        env.storage().persistent().set(&DataKey::Nullifier(nullifier), &true);
        Self::enqueue(&env, change_commitment); // change note awaits insertion

        let mut counter: u64 = env.storage().instance().get(&DataKey::SwapCounter).unwrap();
        counter += 1;
        env.storage().instance().set(&DataKey::SwapCounter, &counter);
        env.storage().persistent().set(
            &DataKey::Payout(counter),
            &PayoutDetails {
                blinded_bank_hash,
                amount,
                refund_commitment,
                created: env.ledger().timestamp(),
                status: SwapStatus::Pending,
            },
        );
        counter
    }

    /// Unshield: spend a note and receive the crypto directly into `recipient` (the
    /// inverse of shielding). Reuses the confidential_swap proof — the bank/tier fields
    /// are ignored. Transfers `swap_amount` of the pool token out and mints a change note.
    pub fn unshield(
        env: Env,
        proof_a: BytesN<64>,
        proof_b: BytesN<128>,
        proof_c: BytesN<64>,
        public_signals: Vec<BytesN<32>>,
        recipient: Address,
    ) {
        assert!(public_signals.len() == 7, "unshield: bad public signals");
        Self::require_canonical(&env, &public_signals);
        assert!(
            groth16::verify(&env, &vk::confidential_swap_vk(&env), &Self::g1(&env, &proof_a),
                &Self::g2(&env, &proof_b), &Self::g1(&env, &proof_c),
                &Self::to_fr_vec(&env, &public_signals)),
            "unshield: invalid proof"
        );

        // Destination binding (anti front-running): the proof commits to a recipient via
        // public_signals[6] = int_be(sha256(xdr(recipient))) mod r. Recompute it from the
        // passed Address and reject any mismatch, so a malicious/compromised relayer cannot
        // redirect the unshielded crypto to an address the prover never authorized.
        let bound = Self::recipient_field(&env, &recipient);
        let claimed = U256::from_be_bytes(&env, &Bytes::from_array(&env, &public_signals.get(6).unwrap().to_array()));
        assert!(bound == claimed, "unshield: recipient not bound to proof");

        let nullifier = public_signals.get(0).unwrap();
        let change_commitment = public_signals.get(1).unwrap();
        let merkle_root = public_signals.get(3).unwrap();
        let amount = Self::to_i128(&public_signals.get(5).unwrap());

        assert!(
            env.storage().persistent().has(&DataKey::ValidRoot(merkle_root)),
            "unshield: unknown merkle root"
        );
        assert!(
            !env.storage().persistent().has(&DataKey::Nullifier(nullifier.clone())),
            "unshield: nullifier already spent"
        );

        env.storage().persistent().set(&DataKey::Nullifier(nullifier), &true);
        Self::enqueue(&env, change_commitment); // change note awaits insertion

        // Move the crypto out of the pool into the recipient's wallet.
        let token_address: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        token::Client::new(&env, &token_address)
            .transfer(&env.current_contract_address(), &recipient, &amount);
    }

    /// V2 private transfer: spend one note, create TWO output notes (recipient + change)
    /// entirely inside the pool. Amounts are hidden; `recipient_owner` is bound in the proof.
    /// No token movement — value just changes owner. public signals =
    ///   [nullifier, out_recipient_commitment, out_change_commitment, merkle_root, recipient_owner].
    pub fn shielded_transfer(
        env: Env,
        proof_a: BytesN<64>,
        proof_b: BytesN<128>,
        proof_c: BytesN<64>,
        public_signals: Vec<BytesN<32>>,
    ) {
        assert!(public_signals.len() == 5, "transfer: bad public signals");
        Self::require_canonical(&env, &public_signals);
        assert!(
            groth16::verify(&env, &vk::shielded_transfer_vk(&env), &Self::g1(&env, &proof_a),
                &Self::g2(&env, &proof_b), &Self::g1(&env, &proof_c),
                &Self::to_fr_vec(&env, &public_signals)),
            "transfer: invalid proof"
        );

        let nullifier = public_signals.get(0).unwrap();
        let out_recipient = public_signals.get(1).unwrap();
        let out_change = public_signals.get(2).unwrap();
        let merkle_root = public_signals.get(3).unwrap();
        // public_signals[4] = recipient_owner (bound inside the proof; no contract action needed)

        assert!(
            env.storage().persistent().has(&DataKey::ValidRoot(merkle_root)),
            "transfer: unknown merkle root"
        );
        assert!(
            !env.storage().persistent().has(&DataKey::Nullifier(nullifier.clone())),
            "transfer: nullifier already spent"
        );

        env.storage().persistent().set(&DataKey::Nullifier(nullifier), &true);
        Self::enqueue(&env, out_recipient); // recipient's note awaits insertion
        Self::enqueue(&env, out_change);    // sender's change note awaits insertion
        // No token transfer — the value stays pooled, just re-owned privately.
    }

    /// Admin (relayer that paid the naira) sweeps the swapped crypto to the treasury.
    /// NOTE: fiat-settlement (zkTLS) proof is future work; the user's trustless
    /// protection is `refund_swap` after the timeout if this is never called.
    pub fn claim_swap(env: Env, swap_id: u64) {
        let admin = Self::admin(&env);
        admin.require_auth();
        let key = DataKey::Payout(swap_id);
        let mut payout: PayoutDetails =
            env.storage().persistent().get(&key).expect("claim: no such swap");
        assert!(payout.status == SwapStatus::Pending, "claim: not pending");
        payout.status = SwapStatus::Completed;
        env.storage().persistent().set(&key, &payout);

        let token_address: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        token::Client::new(&env, &token_address)
            .transfer(&env.current_contract_address(), &admin, &payout.amount);
    }

    /// Trustless refund: if the fiat never settled, after the timeout the user reclaims
    /// the swapped value by queueing their pre-committed refund note. No trust required.
    pub fn refund_swap(env: Env, swap_id: u64) {
        let key = DataKey::Payout(swap_id);
        let mut payout: PayoutDetails =
            env.storage().persistent().get(&key).expect("refund: no such swap");
        assert!(payout.status == SwapStatus::Pending, "refund: not pending");
        assert!(
            env.ledger().timestamp() >= payout.created + REFUND_DELAY,
            "refund: time-lock active"
        );
        payout.status = SwapStatus::Refunded;
        env.storage().persistent().set(&key, &payout);
        Self::enqueue(&env, payout.refund_commitment);
    }

    // ---- views ----
    pub fn current_root(env: Env) -> BytesN<32> {
        env.storage().instance().get(&DataKey::CurrentRoot).unwrap()
    }
    pub fn next_index(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::NextIndex).unwrap()
    }
    pub fn get_payout(env: Env, swap_id: u64) -> PayoutDetails {
        env.storage().persistent().get(&DataKey::Payout(swap_id)).unwrap()
    }

    // ---- internal helpers ----
    fn admin(env: &Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).unwrap()
    }

    fn enqueue(env: &Env, commitment: BytesN<32>) {
        // Add to the pending set (order-independent). insert() can later append any
        // pending commitment, so multiple users can deposit/swap concurrently.
        env.storage().persistent().set(&DataKey::Pending(commitment), &true);
    }

    fn g1(_env: &Env, b: &BytesN<64>) -> soroban_sdk::crypto::bn254::Bn254G1Affine {
        soroban_sdk::crypto::bn254::Bn254G1Affine::from_bytes(b.clone())
    }
    fn g2(_env: &Env, b: &BytesN<128>) -> soroban_sdk::crypto::bn254::Bn254G2Affine {
        soroban_sdk::crypto::bn254::Bn254G2Affine::from_bytes(b.clone())
    }

    fn to_fr_vec(env: &Env, signals: &Vec<BytesN<32>>) -> Vec<Fr> {
        let mut out: Vec<Fr> = Vec::new(env);
        for s in signals.iter() {
            out.push_back(fr_from(env, &s.to_array()));
        }
        out
    }

    /// Field encoding of a recipient Address, matched bit-for-bit by the browser prover:
    ///   int_be(sha256(xdr(address))) mod r
    /// Used to bind an unshield's on-chain destination into the zero-knowledge proof.
    fn recipient_field(env: &Env, addr: &Address) -> U256 {
        let xdr = addr.clone().to_xdr(env);
        let h: BytesN<32> = env.crypto().sha256(&xdr).into();
        let hv = U256::from_be_bytes(env, &Bytes::from_array(env, &h.to_array()));
        let r = U256::from_be_bytes(env, &Bytes::from_array(env, &R_BE));
        hv.rem_euclid(&r)
    }

    /// Reject non-canonical (>= r) public signals to prevent aliasing attacks.
    fn require_canonical(env: &Env, signals: &Vec<BytesN<32>>) {
        let r = U256::from_be_bytes(env, &Bytes::from_array(env, &R_BE));
        for s in signals.iter() {
            let v = U256::from_be_bytes(env, &Bytes::from_array(env, &s.to_array()));
            assert!(v < r, "non-canonical public signal");
        }
    }

    fn to_i128(b: &BytesN<32>) -> i128 {
        let a = b.to_array();
        for i in 0..16 {
            assert!(a[i] == 0, "value exceeds i128");
        }
        let mut v: i128 = 0;
        for i in 16..32 {
            v = (v << 8) | (a[i] as i128);
        }
        v
    }
    fn to_u32(b: &BytesN<32>) -> u32 {
        let a = b.to_array();
        for i in 0..28 {
            assert!(a[i] == 0, "value exceeds u32");
        }
        ((a[28] as u32) << 24) | ((a[29] as u32) << 16) | ((a[30] as u32) << 8) | (a[31] as u32)
    }
}
