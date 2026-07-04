# ShieldPass V2: SDK, Contracts, and Proofs Architecture

This document outlines how the new architecture works together: The Noir ZK Proofs, the Soroban Smart Contracts, and how a developer uses the ShieldPass SDK.

---

## 1. The Zero-Knowledge Proofs (Noir)

We now have two distinct proofs. One for Identity, one for Payments.

### Circuit A: Reusable KYC (`circuits/reusable_kyc/src/main.nr`)
This circuit proves that a user holds a valid KYC credential from the trusted issuer, and outputs a `compliance_nullifier` that acts as their "Reusable Pass".

```rust
use dep::std;

global DEPTH: u32 = 16;

fn main(
    // Private Inputs (User's secrets)
    secret_salt: Field,
    kyc_passed: Field,
    not_sanctioned: Field,
    merkle_path: [Field; DEPTH],
    merkle_indices: [Field; DEPTH],
    
    // Public Inputs
    merkle_root: pub Field,
) -> pub Field {
    // 1. Check Compliance
    assert(kyc_passed == 1);
    assert(not_sanctioned == 1);

    // 2. Prove inclusion in the Issuer's Merkle Tree
    let leaf = std::hash::poseidon::bn254::hash_3([secret_salt, kyc_passed, not_sanctioned]);
    let computed_root = compute_merkle_root(leaf, merkle_path, merkle_indices);
    assert(computed_root == merkle_root);

    // 3. Output the Reusable Compliance Nullifier
    // This allows the user to prove they are the SAME compliant person
    // across multiple dApps without revealing WHO they are.
    let compliance_nullifier = std::hash::poseidon::bn254::hash_1([secret_salt]);
    
    compliance_nullifier
}
```

### Circuit B: Shielded Pool Transfer (`circuits/shielded_transfer/src/main.nr`)
This circuit allows private token transfers. It takes the `compliance_nullifier` from Circuit A to ensure the sender is legally allowed to transact.

```rust
fn main(
    // Private Inputs
    private_note_secret: Field,
    amount: Field,
    recipient_address: Field,
    compliance_nullifier: Field, // Links to Circuit A
    
    // Public Inputs
    public_pool_root: pub Field,
) -> pub Field {
    // 1. Prove ownership of the private note in the Shielded Pool
    // 2. Prove the compliance_nullifier is valid
    // 3. Output the spent nullifier to prevent double-spending
    
    let spend_nullifier = std::hash::poseidon::bn254::hash_2([private_note_secret, compliance_nullifier]);
    spend_nullifier
}
```

---

## 2. Soroban Smart Contracts (Rust)

The smart contracts handle the public verification of the private math.

### The Shielded Pool Contract (`contracts/shielded_pool/src/lib.rs`)

```rust
#![no_std]
use soroban_sdk::{contract, contractimpl, Address, BytesN, Env, symbol_short};

#[contract]
pub struct ShieldPassPool;

#[contractimpl]
impl ShieldPassPool {
    
    // 1. Deposit: Anyone can deposit public USDC into the pool.
    // They provide a cryptographic "note commitment" hiding their balance.
    pub fn deposit(env: Env, from: Address, amount: i128, note_commitment: BytesN<32>) {
        from.require_auth();
        // Transfer USDC from user to this contract
        // Add note_commitment to the Pool's Merkle Tree
    }

    // 2. Withdraw/Transfer: The magic happens here.
    // No "from" address is provided. The user just provides a ZK Proof!
    pub fn shielded_transfer(
        env: Env, 
        zk_proof: BytesN<256>, // The Groth16 Proof
        spend_nullifier: BytesN<32>, 
        recipient: Address, 
        amount: i128
    ) {
        // A. Check if spend_nullifier is already used (prevent double spend)
        assert!(!is_spent(&env, spend_nullifier.clone()));

        // B. Verify the ZK Proof Natively on Stellar
        // This proof confirms: The note exists AND the sender passed KYC.
        let is_valid = verify_proof_natively(&env, zk_proof);
        assert!(is_valid, "Invalid ZK Proof or KYC failed");

        // C. Mark as spent and release funds
        mark_spent(&env, spend_nullifier);
        transfer_usdc_to(&env, recipient, amount);
    }
}
```

---

## 3. The Developer SDK (`@shieldpass/sdk`)

This is what makes it a winning hackathon project. Instead of building just an app, we give developers a tool they can install via `npm install @shieldpass/sdk`.

### How a developer uses it:

```typescript
import { ShieldPassSDK } from '@shieldpass/sdk';

// Initialize the SDK
const shieldPass = new ShieldPassSDK({
    network: 'testnet',
    rpcUrl: 'https://soroban-testnet.stellar.org'
});

// Scenario: An AI Agent wants to pay for API access privately.

// 1. The SDK generates the ZK Proofs LOCALLY in the browser/node environment.
// Private keys and secrets never leave the machine.
const privatePaymentProof = await shieldPass.generateShieldedTransfer({
    amount: 50,
    recipient: 'G...RECEIVER_ADDRESS',
    // The SDK automatically fetches the user's/agent's local compliance secrets
    useLocalComplianceCredentials: true 
});

// 2. Submit the private transaction to the Stellar Network
const txHash = await shieldPass.submitToPool(privatePaymentProof);

console.log("Private Compliant Payment Successful! TX:", txHash);
// The blockchain only sees encrypted hashes. 
// No one knows who sent the money, but the protocol guarantees they are KYC'd.
```
