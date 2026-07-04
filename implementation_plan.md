# Pivot: ZK-Powered Nigerian P2P on Stellar (ShieldPass)

This plan outlines the pivot from a general cross-border compliance tool to a highly localized, Zero-Knowledge powered P2P exchange for the Nigerian market. 

## User Review Required
> [!IMPORTANT]
> **The Core Mechanics Change:**
> Instead of a simple "payment gateway", your smart contract now needs to act as an **Escrow**. The crypto seller will lock their USDC/XLM in the smart contract. It will only be released to the buyer once the seller confirms receipt of the Naira bank transfer. The ZK proof is used to ensure both parties are "verified" without exposing their real identities.

## 1. SDK Changes (Is it still necessary?)
**Yes, the SDK is absolutely necessary.** Your SDK folder contains the "magic" of the project: the ZK circuits and the Soroban smart contracts. However, their logic must change:

### ZK Circuit (`SDK/circuits/...`)
Instead of checking global sanctions and country codes, the ZK proof will now verify "Light Nigerian KYC".
*   **Old Inputs:** `country_eligible`, `sanctions_clear`, `age_over_18`
*   **New Inputs:** `is_human` (mock liveness check), `bvn_verified` (mock Nigerian BVN check), `account_in_good_standing` (no scam reports).

### Smart Contracts (`SDK/contracts/...`)
*   `compliance_registry`: Remains mostly the same. It tracks the Merkle root of verified users.
*   `payment_gateway` **becomes** `p2p_escrow`: 
    *   `create_offer(amount, price, nullifier)`: Locks crypto.
    *   `accept_offer(offer_id, nullifier)`: Locks the deal to a specific buyer.
    *   `release_crypto(offer_id)`: Seller calls this after receiving Naira in their bank account.

## 2. Frontend Designer Requirements (Pages Needed)
The frontend designer needs to prepare **5 core pages**.

> [!TIP]
> **Does the Frontend Dev need Rust installed?**
> **NO.** The Rust contracts will be compiled and deployed to the Stellar Testnet by the backend/smart contract dev. The frontend developer only needs **Node.js/npm** to interact with the blockchain using the standard JavaScript `@stellar/stellar-sdk` and the backend API.

1.  **Landing Page:** Pitching "The first private, scam-free P2P for Nigeria."
2.  **Verification (Onboarding):** A mock screen where the user enters a fake BVN and does a "liveness check" to receive their ZK Pass.
3.  **P2P Marketplace (Order Book):** A list of available offers (e.g., "Selling 500 USDC at ₦1,500/USDC"). Users can filter by asset (XLM, USDC, NGNC).
4.  **Trade Room (Active Escrow):** The screen where the active trade happens. Shows the seller's bank details to the buyer. Includes a "Generate ZK Proof" button to securely enter the trade, and a "I have paid" / "Release Crypto" button.
5.  **Dashboard:** Shows the user's current crypto balances, active trades, and their "Verified" status.

## 3. Developer Workflows & Responsibilities

To move fast in a 12-day hackathon, divide the work cleanly between Backend/Smart Contract and Frontend.

### Backend & Smart Contract Developer Workflow
1.  **Rust Contracts:** Write the `compliance_registry` and `p2p_escrow` contracts in Rust. Deploy them to the Stellar Testnet. Provide the Contract IDs to the frontend dev.
2.  **ZK Circuits (Noir):** Write the updated `main.nr` circuit for the BVN/Liveness check. Compile the circuit to a JSON artifact for the frontend to use.
3.  **Backend API (Node.js):** Build a simple Express server that:
    *   Takes the "mock BVN" from the frontend.
    *   Adds the user to an off-chain Merkle tree and gives them their `secret_salt`.
    *   Periodically publishes the new Merkle root to the `compliance_registry` contract.

### Frontend Developer Workflow
1.  **UI/UX:** Build the React/Vite interfaces listed above using Tailwind CSS.
2.  **Wallet Integration:** Integrate Freighter or Stellar Wallets Kit so users can connect their accounts.
3.  **In-Browser Proving:** Use `bb.js` to generate the Zero-Knowledge proof locally in the browser when the user clicks "Start Trade".
4.  **API & Contract Calls:** Send the generated ZK proof to the backend, and use the `@stellar/stellar-sdk` to read escrow balances and interact with the deployed smart contracts.

## Open Questions
*   For the P2P Escrow, do you want to implement a "Dispute" mechanism (where an admin can step in if the seller refuses to release), or keep it simple for the hackathon and assume honest sellers once the trade starts?
*   Should we proceed with modifying the `Implementation.md` and the actual `SDK` code to match this plan?
