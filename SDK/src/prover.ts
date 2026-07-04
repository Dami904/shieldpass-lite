import { UltraHonkBackend, Barretenberg } from '@aztec/bb.js';
import { Noir } from '@noir-lang/noir_js';
import { KYCProofParams, ZKProofResult, CompiledCircuit } from './types';

export class ShieldPassProver {
    private noir: Noir | null = null;
    private backend: UltraHonkBackend | null = null;
    private barretenberg: Barretenberg | null = null;
    private initialized = false;

    /**
     * @param circuit The compiled Noir circuit (reusable_kyc.json). Injected rather
     *   than hardcoded so the SAME prover runs in node (import the json) and the
     *   browser (fetch it) without the SDK owning a file path.
     */
    constructor(private readonly circuit: CompiledCircuit) {
        if (!circuit || !circuit.bytecode) {
            throw new Error('[ShieldPassProver] A compiled circuit with `bytecode` is required.');
        }
    }

    /**
     * Initialize the Barretenberg WASM backend and Noir JS.
     * Must be called once before generating any proofs.
     */
    async init() {
        if (this.initialized) return;
        console.log('[ShieldPassProver] Initializing Barretenberg API...');
        this.barretenberg = await Barretenberg.new({ threads: 1 });
        this.backend = new UltraHonkBackend(this.circuit.bytecode, this.barretenberg);
        this.noir = new Noir(this.circuit as any);
        this.initialized = true;
        console.log('[ShieldPassProver] Ready.');
    }

    /**
     * Generates a reusable KYC compliance proof locally.
     * All private inputs stay in the browser — nothing is sent to any server.
     * @param params — must match the main() inputs in reusable_kyc/src/main.nr
     */
    async proveKYC(params: KYCProofParams): Promise<ZKProofResult> {
        if (!this.noir || !this.backend || !this.initialized) {
            throw new Error('[ShieldPassProver] Not initialized. Call init() first.');
        }

        // Validate required fields before running the expensive circuit
        const required: (keyof KYCProofParams)[] = [
            'secret_salt', 'hardware_attested', 'bvn_verified', 'good_standing',
            'merkle_path', 'merkle_indices', 'merkle_root', 'current_timestamp', 'nullifier', 'require_bvn'
        ];
        for (const field of required) {
            if (params[field] === undefined || params[field] === null || params[field] === '') {
                throw new Error(`[ShieldPassProver] Missing required input: ${field}`);
            }
        }

        if (params.merkle_path.length !== 8 || params.merkle_indices.length !== 8) {
            throw new Error('[ShieldPassProver] merkle_path and merkle_indices must have exactly 8 elements (DEPTH=8).');
        }

        console.log('[ShieldPassProver] Generating witness (private computation)...');
        // KYCProofParams is a typed view of Noir's InputMap (string-keyed Field map).
        const { witness } = await this.noir.execute(params as any);

        console.log('[ShieldPassProver] Generating UltraHonk proof...');
        const { proof, publicInputs } = await this.backend.generateProof(witness);

        console.log('[ShieldPassProver] ✅ Proof generated successfully.');
        return {
            proof,
            publicInputs,
            nullifier: params.nullifier,
        };
    }

    /**
     * Verifies a proof locally using the same backend.
     * The relayer also does this — this is a client-side sanity check.
     */
    async verifyProof(proof: Uint8Array, publicInputs: string[]): Promise<boolean> {
        if (!this.backend || !this.initialized) {
            throw new Error('[ShieldPassProver] Not initialized. Call init() first.');
        }
        const isValid = await this.backend.verifyProof({ proof, publicInputs });
        console.log(`[ShieldPassProver] Local verification result: ${isValid}`);
        return isValid;
    }
}
