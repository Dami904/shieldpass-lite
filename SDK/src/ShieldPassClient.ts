import { ShieldPassProver } from './prover';
import { StellarContractClient } from './stellar';
import { ShieldPassConfig, KYCProofParams, ZKProofResult, RelayerResponse } from './types';
import { isValidStellarAddress, proofToHex } from './utils';

export class ShieldPassClient {
    private prover: ShieldPassProver;
    private stellarClient: StellarContractClient;
    private initialized = false;

    constructor(config: ShieldPassConfig) {
        if (!config.contractId) throw new Error('[ShieldPassClient] contractId is required in config.');
        if (!config.rpcUrl) throw new Error('[ShieldPassClient] rpcUrl is required in config.');
        if (!config.networkPassphrase) throw new Error('[ShieldPassClient] networkPassphrase is required in config.');

        if (!config.circuit) throw new Error('[ShieldPassClient] config.circuit (compiled reusable_kyc.json) is required.');

        this.prover = new ShieldPassProver(config.circuit);
        this.stellarClient = new StellarContractClient(
            config.rpcUrl,
            config.networkPassphrase,
            config.contractId
        );
    }

    /**
     * MUST be called before using the client.
     * Loads the Barretenberg WASM backend into memory.
     */
    async init() {
        if (this.initialized) return;
        await this.prover.init();
        this.initialized = true;
        console.log('[ShieldPassClient] Initialized and ready.');
    }

    private assertInitialized() {
        if (!this.initialized) {
            throw new Error('[ShieldPassClient] Client not initialized. Call await client.init() first.');
        }
    }

    /**
     * Generates a reusable KYC compliance proof entirely in the browser.
     * The secret salt NEVER leaves the user's device.
     * @param params — field names must match main.nr circuit inputs exactly
     */
    async generateKYCProof(params: KYCProofParams): Promise<ZKProofResult> {
        this.assertInitialized();
        // Validate walletAddress is not in params (it's not a circuit input — keep them separate)
        console.log('[ShieldPassClient] Generating KYC proof locally...');
        return await this.prover.proveKYC(params);
    }

    /**
     * Verifies the proof client-side before sending to the relayer.
     * Saves a round-trip if the proof is invalid.
     */
    async verifyProofLocally(proof: Uint8Array, publicInputs: string[]): Promise<boolean> {
        this.assertInitialized();
        return await this.prover.verifyProof(proof, publicInputs);
    }

    /**
     * Submits the ZK proof to the ShieldPass backend relayer.
     * The relayer verifies it and submits the Stellar transaction.
     * @param relayerUrl The backend URL e.g. http://localhost:3001
     * @param walletAddress The user's Stellar wallet address
     * @param proofResult The result from generateKYCProof
     * @param action The contract function to call e.g. 'create_offer'
     */
    async submitProofToRelayer(
        relayerUrl: string,
        walletAddress: string,
        proofResult: ZKProofResult,
        action: string
    ): Promise<RelayerResponse> {
        this.assertInitialized();

        if (!isValidStellarAddress(walletAddress)) {
            throw new Error('[ShieldPassClient] Invalid Stellar wallet address.');
        }
        if (!action || action.trim().length === 0) {
            throw new Error('[ShieldPassClient] Action is required (e.g. "create_offer").');
        }
        if (!proofResult.proof || proofResult.proof.length === 0) {
            throw new Error('[ShieldPassClient] Proof bytes are empty. Generate a proof first.');
        }

        // Convert Uint8Array proof to hex string for JSON transport
        const proofHex = proofToHex(proofResult.proof);

        const response = await fetch(`${relayerUrl}/verify/submit-proof`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                walletAddress,
                proof: proofHex,
                publicInputs: proofResult.publicInputs,
                nullifier: proofResult.nullifier,
                action,
            }),
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({ error: 'Unknown relayer error' }));
            throw new Error(`[ShieldPassClient] Relayer rejected proof: ${err.error}`);
        }

        return response.json();
    }
}
