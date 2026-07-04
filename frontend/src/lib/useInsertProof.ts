/**
 * useInsertProof — reusable hook for the client-side merkle_insert flow.
 *
 * Usage:
 *   const { insertProof } = useInsertProof();
 *   const { index } = await insertProof(commitment.toString(), setStatus);
 *
 * Flow:
 *   1. POST /tree/assign  — backend reserves the next index and returns circuit input.
 *   2. Download merkle_insert.wasm + merkle_insert_final.zkey (cached after first load).
 *   3. Run prove() in a Web Worker (UI stays responsive).
 *   4. POST /tree/confirm — backend submits proof on-chain, marks leaf confirmed.
 *
 * The function never throws for proof/confirm failures — it logs a warning and
 * returns the assigned index anyway. The deposit is already safe on-chain; the
 * leaf index is what the frontend needs to show the shielded balance.
 */

import { api } from './api';
import { assetByCode } from './assets';

/** The shielded_pool contract id that holds a given asset's tree (undefined → default/XLM). */
function poolForAsset(asset?: string): string | undefined {
    return assetByCode(asset)?.poolContractId;
}


// Cache the raw ArrayBuffers. Uint8Arrays backed by transferred ArrayBuffers become
// neutered (byteLength = 0) after a Web Worker transfer, so we store the originals
// and slice a fresh copy for each worker call (slice = O(n) copy, not zero-copy).
let cachedWasmBuf: ArrayBuffer | null = null;
let cachedZkeyBuf: ArrayBuffer | null = null;

async function loadCircuits(): Promise<{ wasmBytes: Uint8Array; zkeyBytes: Uint8Array }> {
    if (!cachedWasmBuf || !cachedZkeyBuf) {
        const [wasmBuf, zkeyBuf] = await Promise.all([
            fetch('/merkle_insert.wasm').then((r) => r.arrayBuffer()),
            fetch('/merkle_insert_final.zkey').then((r) => r.arrayBuffer()),
        ]);
        cachedWasmBuf = wasmBuf;
        cachedZkeyBuf = zkeyBuf;
    }
    // Each call gets a fresh Uint8Array whose buffer can be safely transferred.
    return {
        wasmBytes: new Uint8Array(cachedWasmBuf!.slice(0)),
        zkeyBytes: new Uint8Array(cachedZkeyBuf!.slice(0)),
    };
}

function runProofInWorker(
    input: Record<string, unknown>,
    wasmBytes: Uint8Array,
    zkeyBytes: Uint8Array,
): Promise<{ bundle: any }> {
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL('../workers/prover.worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (e) => {
            worker.terminate();
            if (e.data.type === 'result') resolve({ bundle: e.data.bundle });
            else reject(new Error(e.data.message));
        };
        worker.onerror = (err) => {
            worker.terminate();
            reject(new Error(err.message));
        };
        // Transfer ownership of ArrayBuffers for zero-copy transfer to worker.
        worker.postMessage({ input, wasmBytes, zkeyBytes },
            [wasmBytes.buffer, zkeyBytes.buffer]);
    });
}

/**
 * Run prove → confirm for a leaf that was already assigned by the server.
 * Use this when the backend returns a circuitInput directly (e.g. faucet notes)
 * so we skip the /tree/assign round-trip.
 */
export async function proveAndConfirm(
    index: number,
    circuitInput: Record<string, unknown>,
    setStatus?: (s: string) => void,
    pool?: string,
): Promise<void> {
    setStatus?.('Loading ZK circuit…');
    const { wasmBytes, zkeyBytes } = await loadCircuits();

    setStatus?.('Generating proof in your browser…');
    let bundle: any;
    try {
        ({ bundle } = await runProofInWorker(circuitInput, wasmBytes, zkeyBytes));
    } catch (proveErr: any) {
        console.warn('[proveAndConfirm] proof generation failed (leaf already reserved):', proveErr?.message);
        return;
    }

    setStatus?.('Submitting proof…');
    try {
        await api.treeConfirm(index, {
            proof_a: Array.from(bundle.proof.a),
            proof_b: Array.from(bundle.proof.b),
            proof_c: Array.from(bundle.proof.c),
            public_signals: bundle.publicSignals.map((s: Uint8Array) => Array.from(s)),
        }, pool);
    } catch (confirmErr: any) {
        console.warn('[proveAndConfirm] confirm failed (leaf still reserved):', confirmErr?.message);
    }
}

/**
 * On page load, check each unconfirmed note against the backend and re-prove
 * any that are still pending. Returns the leaf indices that are now confirmed.
 * Runs proofs sequentially to avoid OOM from concurrent snarkjs workers.
 */
export async function retryPendingProofs(
    notes: { leafIndex: number; confirmed?: boolean; asset?: string }[],
): Promise<number[]> {
    const unconfirmed = notes.filter(n => n.confirmed !== true);
    if (unconfirmed.length === 0) return [];

    const confirmedIndices: number[] = [];

    for (const note of unconfirmed) {
        const pool = poolForAsset(note.asset);
        try {
            const res = await api.treeRetry(note.leafIndex, pool);
            if (res.status === 'confirmed') {
                confirmedIndices.push(note.leafIndex);
                continue;
            }
            // Still pending — re-prove
            if ('circuitInput' in res && res.circuitInput) {
                const { wasmBytes, zkeyBytes } = await loadCircuits();
                let bundle: any;
                try {
                    ({ bundle } = await runProofInWorker(res.circuitInput, wasmBytes, zkeyBytes));
                } catch {
                    continue; // proof failed — will retry next page load
                }
                try {
                    await api.treeConfirm(note.leafIndex, {
                        proof_a: Array.from(bundle.proof.a),
                        proof_b: Array.from(bundle.proof.b),
                        proof_c: Array.from(bundle.proof.c),
                        public_signals: bundle.publicSignals.map((s: Uint8Array) => Array.from(s)),
                    }, pool);
                    confirmedIndices.push(note.leafIndex);
                } catch {
                    // confirm failed — will retry next page load
                }
            }
        } catch {
            // 404 = leaf was rolled back by cleanup job. Treat as confirmed so we
            // stop retrying it — the user will get a fresh note on next onboarding.
            confirmedIndices.push(note.leafIndex);
        }
    }

    return confirmedIndices;
}

export function useInsertProof() {
    /**
     * Run the full assign → prove → confirm flow for one commitment.
     * @param commitment  Decimal string field element (e.g. commitment.toString())
     * @param setStatus   Optional UI status setter
     * @returns { index } — the leaf index assigned (always returned, even on prove failure)
     */
    const insertProof = async (
        commitment: string,
        setStatus?: (s: string) => void,
        pool?: string,
    ): Promise<{ index: number }> => {
        // Step 1: assign — fast DB write, returns circuit input
        setStatus?.('Reserving slot in the shielded tree…');
        const { index, circuitInput } = await api.treeAssign(commitment, pool);

        // Step 2: download circuits (cached after first call)
        setStatus?.('Loading ZK circuit…');
        const { wasmBytes, zkeyBytes } = await loadCircuits();

        // Step 3: prove in Web Worker (non-blocking)
        setStatus?.('Generating proof in your browser…');
        let bundle: any;
        try {
            ({ bundle } = await runProofInWorker(circuitInput, wasmBytes, zkeyBytes));
        } catch (proveErr: any) {
            // Non-fatal: return the index so the caller can save the note.
            console.warn('[useInsertProof] proof generation failed (note still saved):', proveErr?.message);
            return { index };
        }

        // Step 4: confirm — backend submits proof on-chain
        setStatus?.('Submitting proof…');
        try {
            await api.treeConfirm(index, {
                proof_a: Array.from(bundle.proof.a),
                proof_b: Array.from(bundle.proof.b),
                proof_c: Array.from(bundle.proof.c),
                public_signals: bundle.publicSignals.map((s: Uint8Array) => Array.from(s)),
            }, pool);
        } catch (confirmErr: any) {
            // Non-fatal: index is reserved; the leaf can be confirmed later.
            console.warn('[useInsertProof] confirm failed (note still saved):', confirmErr?.message);
        }

        return { index };
    };

    return { insertProof };
}
