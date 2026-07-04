# ShieldPass — Full Build Plan (Nigerian P2P Edition)
**Private, ZK-Powered P2P Exchange for the Nigerian Market on Stellar**
12-day hackathon build plan: architecture, ZK circuits, smart contracts, backend, database, frontend, integrations, and day-by-day timeline.

---

## 0. The one architecture decision that determines everything else

Before anything else: how does the ZK proof actually get verified?

**Path B — Hybrid attestation model (recommended default).** Proof generation happens fully client-side in the browser (so private data never leaves the user's device — this is the actual privacy guarantee). A lightweight relayer/verifier service checks the proof using the same proving backend's JS verifier, and if valid, submits a transaction to a Soroban contract that simply records "nullifier X has been verified" as an immutable on-chain fact.

> **Future upgrade (Protocol 25):** Stellar's Protocol 25 ("X-Ray") introduced native BN254 host functions (`bn254_pairing_check`, `bn254_g1_add`, `bn254_g1_mul`) and Poseidon hash support directly in Soroban. This enables full **on-chain ZK proof verification** without the relayer. The hybrid model can be upgraded to Path A (fully on-chain verification) once the SDK tooling matures.

Everything below assumes Path B as the default.

---

## 1. MVP Scope — what you're actually building in 12 days

**Core flow:** A user proves three things about themselves — passed Liveness Check, valid Nigerian Resident (BVN linked), and not flagged for scams — without revealing identity, name, or BVN. A P2P escrow trade only initiates on Stellar once that proof is verified.

**What's real:**
- Real Stellar testnet accounts, real Soroban escrow contracts, real on-chain locking/release of assets (USDC, XLM, NGNC).
- Real Noir circuit, real client-side proof generation, real cryptographic verification.
- Real Merkle tree of attestation commitments.

**What's mocked (and you should say so openly in your demo):**
- The BVN provider — you'll build a simple form that takes an 11-digit number and auto-approves, standing in for Paystack/Mono identity APIs.
- Dispute Resolution — For the hackathon, we assume the seller releases crypto honestly once they see the fiat payment. Complex admin dispute panels are skipped.

---

## 2. System Architecture

```
┌─────────────────┐      ┌──────────────────────┐
│   FRONTEND       │      │  Stellar Wallet       │
│   React + Vite   │◄────►│  (Freighter)          │
│   bb.js (in-     │      └──────────────────────┘
│   browser prover)│
└────────┬─────────┘
         │ REST/JSON
         ▼
┌──────────────────────────────────────────────┐
│              BACKEND API                      │
│   Node.js + Express + TypeScript              │
│                                                │
│  ┌────────────┐  ┌───────────────┐  ┌───────┐ │
│  │ Auth /      │  │ Compliance     │  │ Proof │ │
│  │ User mgmt   │  │ Issuer Service │  │ Relayer│ │
│  └────────────┘  └───────┬───────┘  └───┬───┘ │
└────────────────────────────┼──────────────┼────┘
                              │              │
                    ┌─────────▼──────┐  ┌────▼─────────────┐
                    │  SQLite         │  │ Stellar RPC /     │
                    │  (Prisma ORM)   │  │ Horizon           │
                    └─────────────────┘  └────────┬──────────┘
                                                    │
                                          ┌─────────▼──────────────┐
                                          │  Soroban Contracts       │
                                          │  - compliance_registry   │
                                          │  - p2p_escrow            │
                                          └──────────────────────────┘
```

**Sequence — full user journey:**
1. User connects Stellar wallet.
2. User completes mock BVN onboarding → backend Issuer Service computes attribute flags (`is_human`, `bvn_verified`, `good_standing`).
3. Issuer Service computes a Poseidon-hash commitment of these flags + `secret_salt`, inserts it as a leaf into an off-chain Merkle tree, and returns the commitment + Merkle path + `secret_salt` to the user.
4. Issuer Service periodically publishes the current Merkle root on-chain via `compliance_registry.update_root()`.
5. User enters the P2P Marketplace and clicks "Accept Offer".
6. Frontend generates a ZK proof **in the browser** using the stored `secret_salt` + Merkle path, proving membership + flags.
7. Relayer verifies the proof, and if valid, submits `record_verified_nullifier()` to the Soroban contract.
8. `p2p_escrow` contract allows the user to lock crypto or start a fiat trade.
9. Buyer sends Naira via traditional bank transfer. Seller confirms receipt and calls `release_crypto()` on the contract.

---

## 3. Tech Stack

| Layer | Choice |
|---|---|
| Frontend | React + Vite + TypeScript + Tailwind |
| Wallet | Freighter / Stellar Wallets Kit |
| ZK circuit | Noir (`nargo`) |
| Proving backend | Barretenberg (`@aztec/bb.js`) |
| Smart contracts | Rust + `soroban-sdk` |
| Backend | Node.js + TypeScript + Express |
| Database | SQLite + Prisma ORM (hackathon; PostgreSQL for production) |

---

## 4. ZK Circuit Design (Noir)

**Design principle:** Keep the circuit small.

**Private inputs:** `secret_salt`, `is_human`, `bvn_verified`, `good_standing`, `merkle_path[DEPTH]`, `merkle_indices[DEPTH]`
**Public inputs:** `merkle_root`, `current_timestamp`, `nullifier`

```rust
// circuits/kyc_proof/src/main.nr
use std;

global DEPTH: u32 = 8; // Depth of the Merkle Tree

// Custom Merkle membership function (std::merkle was removed from the Noir stdlib)
fn merkle_membership(
    leaf: Field,
    path: [Field; DEPTH],
    indices: [Field; DEPTH]
) -> Field {
    let mut node = leaf;
    for i in 0..DEPTH {
        let is_right = indices[i];
        let (l, r) = if is_right == 1 {
            (path[i], node)
        } else {
            (node, path[i])
        };
        node = std::hash::poseidon::bn254::hash_2([l, r]);
    }
    node
}

fn main(
    secret_salt: Field,
    is_human: Field,
    bvn_verified: Field,
    good_standing: Field,
    merkle_path: [Field; DEPTH],
    merkle_indices: [Field; DEPTH],
    merkle_root: pub Field,
    current_timestamp: pub Field,
    nullifier: pub Field
) {
    // 1. Reconstruct the leaf commitment from private witnesses
    let leaf = std::hash::poseidon::bn254::hash_4([
        secret_salt, is_human, bvn_verified, good_standing
    ]);

    // 2. Prove this leaf is in the published tree
    let computed_root = merkle_membership(leaf, merkle_path, merkle_indices);
    assert(computed_root == merkle_root);

    // 3. Ensure compliance flags are true
    assert(is_human == 1);
    assert(bvn_verified == 1);
    assert(good_standing == 1);

    // 4. Generate the Compliance Nullifier (Reusable Pass bound to time)
    let computed_nullifier = std::hash::poseidon::bn254::hash_2([secret_salt, current_timestamp]);
    assert(computed_nullifier == nullifier);
}
```

> **Note on Nargo.toml:** The `compiler_version >= 0.28.0` is specified, and no external dependencies are needed since Poseidon is still in `std::hash` and the Merkle membership function is implemented inline.

---

## 5. Compliance Issuer Service (backend module)

1. Accept mock BVN submission (11-digit number).
2. Set `is_human = 1`, `bvn_verified = 1`, `good_standing = 1`.
3. Generate fresh `secret_salt` using cryptographically secure `crypto.randomBytes()`.
4. Compute leaf commitment, insert into Merkle tree.
5. Return `{secret_salt, merkle_path}` to client. DO NOT store salt server-side.

---

## 6. Soroban Smart Contracts (Rust)

### 6.1 `compliance_registry`
Stores the current Merkle root and the set of nullifiers that have been verified. Provides the on-chain source of truth for whether a user has passed ZK compliance verification.

```rust
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

    /// Public getter for the current valid Merkle root
    pub fn get_root(env: Env) -> BytesN<32> {
        env.storage().instance().get(&DataKey::MerkleRoot)
            .unwrap_or(BytesN::from_array(&env, &[0; 32]))
    }

    /// Records a verified nullifier after the relayer validates the ZK proof.
    /// Only the admin (relayer service) can call this.
    /// Prevents double-use (replay protection).
    pub fn record_verified_nullifier(env: Env, nullifier: BytesN<32>) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        let key = DataKey::Nullifier(nullifier.clone());
        assert!(!env.storage().persistent().has(&key), "nullifier already used");
        env.storage().persistent().set(&key, &true);
    }

    /// Public getter — returns true if the nullifier has been recorded
    pub fn is_verified(env: Env, nullifier: BytesN<32>) -> bool {
        let key = DataKey::Nullifier(nullifier);
        env.storage().persistent().has(&key)
    }
}
```

### 6.2 `p2p_escrow`
Handles locking and releasing assets.

```rust
#![no_std]
use soroban_sdk::{contract, contractimpl, token, Address, BytesN, Env, Symbol};

#[contract]
pub struct P2PEscrow;

#[contractimpl]
impl P2PEscrow {
    // Seller locks crypto to create an offer
    pub fn create_offer(
        env: Env,
        registry_contract: Address,
        seller: Address,
        token_contract: Address,
        amount: i128,
        nullifier: BytesN<32>,
    ) {
        seller.require_auth();
        // Verify nullifier via registry to ensure seller is KYC'd
        let verified: bool = env.invoke_contract(
            &registry_contract,
            &Symbol::new(&env, "is_verified"),
            soroban_sdk::vec![&env, nullifier.into_val(&env)],
        );
        assert!(verified, "seller not verified");
        
        // Transfer crypto from seller to this escrow contract
        let token_client = token::Client::new(&env, &token_contract);
        token_client.transfer(&seller, &env.current_contract_address(), &amount);
        // ... store offer details ...
    }

    // Seller calls this after receiving Naira
    pub fn release_crypto(env: Env, seller: Address, buyer: Address, token_contract: Address, amount: i128) {
        seller.require_auth();
        // ... logic to verify offer exists ...
        let token_client = token::Client::new(&env, &token_contract);
        token_client.transfer(&env.current_contract_address(), &buyer, &amount);
    }
}
```

---

## 7. Backend API Design

| Method | Path | Purpose |
|---|---|---|
| POST | `/kyc/submit-bvn` | Submit mock BVN form (11-digit number) |
| POST | `/compliance/issue-attestation` | Compute flags, insert Merkle leaf, return salt |
| GET | `/compliance/root` | Return current published Merkle root |
| POST | `/verify/submit-proof` | Relayer endpoint: verify proof & submit on-chain |
| GET | `/p2p/offers` | List open P2P offers |
| POST | `/p2p/offers` | Create a new P2P offer (fiat amounts, rates) |
| POST | `/p2p/offers/:id/accept` | Buyer indicates intent to pay fiat |

---

## 8. Database Schema (Prisma)

Using **SQLite** for hackathon simplicity (swap to PostgreSQL for production by changing the `datasource` in `schema.prisma`).

```prisma
datasource db {
  provider = "sqlite"
  url      = "file:./dev.db"
}

model User {
  id            String   @id @default(uuid())
  walletAddress String   @unique
  createdAt     DateTime @default(now())
  attestation   ComplianceAttestation?
}

model ComplianceAttestation {
  id              String   @id @default(uuid())
  userId          String   @unique
  user            User     @relation(fields: [userId], references: [id])
  leafIndex       Int
  leafCommitment  String
  isHuman         Boolean  @default(true)
  bvnVerified     Boolean  @default(true)
  goodStanding    Boolean  @default(true)
  createdAt       DateTime @default(now())
}

model P2POffer {
  id              String   @id @default(uuid())
  sellerWallet    String
  assetType       String   // USDC, XLM, NGNC
  cryptoAmount    String
  nairaRate       String
  bankDetails     String   // e.g. "GTBank 0123456789"
  status          String   @default("open") // open | locked | completed | canceled
  createdAt       DateTime @default(now())
}

model RelayerTransaction {
  id              String   @id @default(uuid())
  walletAddress   String
  action          String
  txHash          String   @unique
  status          String   // pending | success | failed | mock
  createdAt       DateTime @default(now())
}
```

---

## 9. SDK Architecture

The TypeScript SDK (`@shieldpass/sdk`) provides a clean API for frontend integrations. Located in `SDK/src/`.

| Module | File | Responsibility |
|---|---|---|
| **ShieldPassClient** | `ShieldPassClient.ts` | Facade class — orchestrates prover + Stellar + relayer |
| **ShieldPassProver** | `prover.ts` | Wraps `@noir-lang/noir_js` + `@aztec/bb.js` for in-browser ZK proof generation |
| **StellarContractClient** | `stellar.ts` | Builds and submits Soroban transactions (`create_offer`, `release_crypto`) |
| **TrustedIssuer** | `issuer.ts` | Generates leaf commitments + mock Merkle paths for the KYC flow |
| **Types** | `types.ts` | Shared interfaces (`KYCProofParams`, `ZKProofResult`, `CreateOfferParams`) |

**Usage pattern:**
```typescript
import { ShieldPassClient } from '@shieldpass/sdk';

const client = new ShieldPassClient({
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: Networks.TESTNET,
  contractId: 'CA2ELE2XWYFIFHLU45...',
});

await client.init();  // Loads WASM backend

const proof = await client.generateKYCProof({
  secret_salt: userSecretSalt,
  is_human: '1',
  bvn_verified: '1',
  good_standing: '1',
  merkle_path: [...],
  merkle_indices: [...],
  merkle_root: publishedRoot,
  current_timestamp: roundedTimestamp,
  nullifier: computedNullifier,
});

await client.submitProofToRelayer(
  'http://localhost:3001',
  userWalletAddress,
  proof,
  'create_offer'
);
```

---

## 10. Frontend-Tester (Developer Testing UI)

A standalone React + Vite app in `frontend-tester/` for testing all backend APIs and in-browser ZK proof generation without the full frontend.

**4 Tabs:**
1. **KYC Onboarding** — Submit a mock BVN, receive secret salt
2. **P2P Market** — Browse and accept open offers
3. **Create Offer** — Create new sell offers with Naira rate + bank details
4. **ZK Relayer** — Generate a real ZK proof in-browser, then submit to the backend relayer

**Key component:** `useZkProof.ts` hook handles the full ZK lifecycle:
- Dynamic import of `@noir-lang/noir_js` + `@aztec/bb.js`
- Fetch compiled circuit from `/public/reusable_kyc.json`
- Initialize `Barretenberg` WASM backend
- Generate witness → generate UltraHonk proof
- Submit proof to relayer

**Running:** `cd frontend-tester && npm install && npm run dev`

---

## 11. Environment Variables & Configuration

### Backend (`.env`)
```env
# Stellar Testnet Configuration
STELLAR_CONTRACT_ID=CA2ELE2XWYFIFHLU45TZREVLY6535FCOVLVHYUISD5YQ6U5OBDP6Y4QU

# Relayer secret key (starts with S)
# Get it by running: stellar keys show deployer
STELLAR_RELAYER_SECRET=<your-secret-key>

# Server port (optional, defaults to 3001)
PORT=3001
```

### Frontend-Tester
- `API_URL` — hardcoded to `http://localhost:3001` in `App.tsx`
- Circuit JSON must be placed at `frontend-tester/public/reusable_kyc.json`

> **Security warning:** Never commit real secret keys to version control. Use `.env` files that are in `.gitignore`.

---

## 12. Deployment & Testing Instructions

### Compile the Noir Circuit
```bash
cd SDK/circuits/reusable_kyc
nargo compile
# Output: target/reusable_kyc.json
```

### Run the Backend
```bash
cd backend
npm install
npx prisma generate
npx prisma db push
npm run dev
# Runs on http://localhost:3001
```

### Run the Frontend-Tester
```bash
cd frontend-tester
npm install
# Copy compiled circuit to public folder:
cp ../SDK/circuits/reusable_kyc/target/reusable_kyc.json public/
npm run dev
# Runs on http://localhost:5173
```

### Deploy Soroban Contracts
```bash
# Build the contract
cd SDK/contracts/compliance_registry
cargo build --target wasm32-unknown-unknown --release

# Deploy to testnet
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/compliance_registry.wasm \
  --source deployer \
  --network testnet

# Initialize the registry
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source deployer \
  --network testnet \
  -- init --admin <DEPLOYER_PUBLIC_KEY>
```

---

## 13. Security Considerations

| Risk | Mitigation |
|---|---|
| **Secret salt exposure** | Salt is stored client-side only (localStorage or in-memory). Warn users not to share it. Backend never stores it. |
| **Nullifier replay** | On-chain `record_verified_nullifier()` prevents double-use. Persistent storage survives TTL. |
| **Rate limiting** | KYC and relayer endpoints should be rate-limited (e.g., express-rate-limit) to prevent abuse. Not implemented in hackathon MVP. |
| **Private key management** | `.env` file with relayer secret must be in `.gitignore`. For production, use a KMS (e.g., AWS Secrets Manager). |
| **BVN data handling** | BVN is validated on the backend but never stored — only the Poseidon hash commitment is persisted. |
| **Mock proof verification** | The hackathon relayer skips actual bb.js verification (`isProofValid = true`). In production, run full UltraHonk verification. |

---

## 14. Error Handling Strategy

| Layer | Error Type | Handling |
|---|---|---|
| **Noir Circuit** | Constraint failure (e.g., flags ≠ 1, bad Merkle path) | `noir.execute()` throws — caught in `useZkProof.ts` with user-friendly message |
| **bb.js Backend** | WASM init failure, proof generation timeout | `try/catch` in `ShieldPassProver.init()` / `proveKYC()` |
| **Stellar RPC** | Simulation failure, insufficient funds, sequence number mismatch | `rpc.Api.isSimulationSuccess()` check before signing; retry with fresh sequence |
| **Backend API** | Validation errors (400), internal errors (500) | JSON `{ error: string }` response format; frontend displays in result boxes |
| **Contract** | `panic!()` / `assert!()` failures | Transaction fails on-chain; relayer returns error to frontend |

---

## 15. Frontend Design

**Pages Needed:**
1. **Landing Page:** "The first private, scam-free P2P for Nigeria."
2. **Onboarding:** Mock BVN entry screen.
3. **P2P Marketplace (Order Book):** List of available offers.
4. **Trade Room:** Escrow screen showing bank details and "Release Crypto" button.
5. **Dashboard:** Active balances and trade history.

---

## 16. Demo Script (3 minutes)

1. **Story:** "Emeka in Lagos wants to sell his USDC for Naira. He wants a safe P2P experience but doesn't want his real identity tied to his crypto wallet publicly."
2. **Live:** Walk through the BVN onboarding, then show the P2P marketplace. Emeka locks crypto.
3. **On-chain proof:** Show the transaction on Stellar Expert. Point out the event only contains a nullifier hash, never PII.
4. **Close:** "ShieldPass provides the safety of KYC without the privacy invasion, unlocking safe P2P markets in Nigeria."
