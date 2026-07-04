/**
 * prover.worker.ts — Off-main-thread ZK proof generation.
 *
 * Receives { wasmBytes, zkeyBytes, input } via postMessage and posts back
 * { type: 'result', proof, publicSignals } or { type: 'error', message }.
 *
 * Running prove() in a Worker keeps the UI (spinner, buttons) fully responsive
 * during the 3–10 second Groth16 witness computation.
 */

import { prove } from '@shieldpass/sdk/dist/groth16Prover';

self.onmessage = async (e: MessageEvent) => {
    const { wasmBytes, zkeyBytes, input } = e.data as {
        wasmBytes: Uint8Array;
        zkeyBytes: Uint8Array;
        input: Record<string, unknown>;
    };
    try {
        const bundle = await prove(input, wasmBytes, zkeyBytes);
        self.postMessage({ type: 'result', bundle });
    } catch (err: any) {
        self.postMessage({ type: 'error', message: err?.message || 'proof generation failed' });
    }
};
