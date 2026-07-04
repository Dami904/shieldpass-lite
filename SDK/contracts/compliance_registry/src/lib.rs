#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, BytesN, Env};

#[contracttype]
pub enum DataKey {
    Admin,
    MerkleRoot,
    Nullifier(BytesN<32>),
}

#[contract]
pub struct ComplianceRegistry;

#[contractimpl]
impl ComplianceRegistry {
    /// Initializes the registry with a trusted admin (the KYC Issuer or a Multi-Sig DAO)
    pub fn init(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    /// Admin securely updates the Merkle Root of all valid Compliance Nullifiers
    pub fn update_root(env: Env, new_root: BytesN<32>) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&DataKey::MerkleRoot, &new_root);
    }

    /// Public getter for the Shielded Pool to read the current valid root
    pub fn get_root(env: Env) -> BytesN<32> {
        env.storage().instance().get(&DataKey::MerkleRoot).unwrap_or(BytesN::from_array(&env, &[0; 32]))
    }

    /// Records a verified nullifier after the relayer has validated the ZK proof.
    /// Only the admin (relayer service) can call this.
    /// Prevents double-use of the same nullifier (replay protection).
    pub fn record_verified_nullifier(env: Env, nullifier: BytesN<32>) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        let key = DataKey::Nullifier(nullifier.clone());
        assert!(!env.storage().persistent().has(&key), "nullifier already used");
        env.storage().persistent().set(&key, &true);
    }

    /// Public getter — returns true if the nullifier has been recorded (i.e., the
    /// user has been verified). Used by p2p_escrow to gate trade initiation.
    pub fn is_verified(env: Env, nullifier: BytesN<32>) -> bool {
        let key = DataKey::Nullifier(nullifier);
        env.storage().persistent().has(&key)
    }
}

