/**
 * ShieldPass SDK — Types
 * Field names match the Noir circuit inputs in SDK/circuits/reusable_kyc/src/main.nr
 */
import { Keypair } from '@stellar/stellar-sdk';

/**
 * How a transaction gets authorized + submitted.
 *  - 'keypair': classic G-account signs and submits via RPC (backend/relayer path).
 *  - 'passkey': caller supplies WebAuthn signing + a gasless submit relay (browser path).
 *    `sign` takes an assembled-transaction XDR and returns a signed XDR (auth entries signed
 *    by the smart wallet). `submit` sends the signed XDR (e.g. to the backend Channels relay)
 *    and returns the transaction hash.
 */
export type Signer =
  | { kind: 'keypair'; keypair: Keypair }
  | { kind: 'passkey'; sign: (xdr: string) => Promise<string>; submit: (signedXdr: string) => Promise<string> };

/** The compiled Noir circuit artifact (reusable_kyc.json from `nargo compile`). */
export interface CompiledCircuit {
    bytecode: string;
    abi?: unknown;
    [key: string]: unknown;
}

export interface ShieldPassConfig {
    rpcUrl: string;
    networkPassphrase: string;
    contractId: string;
    /** The compiled reusable_kyc circuit, loaded by the host (import in node, fetch in browser). */
    circuit: CompiledCircuit;
}

/** Inputs that match main() in reusable_kyc/src/main.nr */
export interface KYCProofParams {
    secret_salt: string;        // Private: never sent to server
    hardware_attested: string;  // '1' or '0' — Tier 1 passkey hardware attestation
    bvn_verified: string;       // '1' or '0' — Tier 2 BVN flag
    good_standing: string;      // '1' or '0'
    merkle_path: string[];      // Array of DEPTH field elements
    merkle_indices: string[];   // Array of DEPTH 0/1 indices
    merkle_root: string;        // Public: the published tree root
    current_timestamp: string;  // Public: rounded timestamp
    nullifier: string;          // Public: poseidon(secret_salt, timestamp)
    require_bvn: string;        // Public: '1' enforces bvn_verified (Tier 2), '0' for Tier 1
}

export interface ZKProofResult {
    proof: Uint8Array;
    publicInputs: string[];
    nullifier: string;
}

/** Params for lock_swap on the Trustless Swap contract. */
export interface LockSwapParams {
    userWallet: string;     // Soroban address (G... or C... smart wallet) locking the crypto
    tokenAddress: string;   // Any Stellar asset contract address (USDC, XLM SAC, AQUA, ...)
    amount: bigint;
    nullifier: string;      // ZK nullifier proving the user passed (progressive) KYC
}

/** Shape returned by the backend relayer's POST /verify/submit-proof. */
export interface RelayerResponse {
    success: boolean;
    message?: string;
    error?: string;
    transaction?: {
        id: string;
        walletAddress: string;
        action: string;
        txHash: string;
        status: string;
    };
}
