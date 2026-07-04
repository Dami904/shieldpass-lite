import * as snarkjs from 'snarkjs';

/** A Groth16 proof serialized to the Soroban contract's byte encoding. */
export interface SerializedProof {
    a: Uint8Array;   // G1, 64 bytes: be(x)||be(y)
    b: Uint8Array;   // G2, 128 bytes: be(x.c1)||be(x.c0)||be(y.c1)||be(y.c0)
    c: Uint8Array;   // G1, 64 bytes
}

export interface ProofBundle {
    proof: SerializedProof;
    publicSignals: Uint8Array[];          // each 32-byte big-endian field element
    raw: { proof: any; publicSignals: string[] }; // snarkjs form (for local verify/debug)
}

/** Encode a BN254 field element as a 32-byte big-endian buffer (Soroban BytesN<32>). */
export function fieldToBytes32(x: bigint): Uint8Array {
    const h = (((x % (2n ** 256n)) + 2n ** 256n) % (2n ** 256n)).toString(16).padStart(64, '0');
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
    return out;
}
const be32 = fieldToBytes32;
function concat(...parts: Uint8Array[]): Uint8Array {
    const len = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(len);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
}
const g1 = (p: string[]): Uint8Array => concat(be32(BigInt(p[0])), be32(BigInt(p[1])));
const g2 = (p: string[][]): Uint8Array =>
    concat(be32(BigInt(p[0][1])), be32(BigInt(p[0][0])), be32(BigInt(p[1][1])), be32(BigInt(p[1][0])));

/** Serialize a snarkjs Groth16 proof + public signals into Soroban byte form. */
export function serializeProof(proof: any, publicSignals: string[]): ProofBundle {
    return {
        proof: { a: g1(proof.pi_a), b: g2(proof.pi_b), c: g1(proof.pi_c) },
        publicSignals: publicSignals.map((s) => be32(BigInt(s))),
        raw: { proof, publicSignals },
    };
}

/**
 * Generate a Groth16 proof in-browser/node. `wasm` and `zkey` are the circuit's
 * compiled artifacts (path string in node, or URL/Uint8Array in the browser) —
 * injected so the SDK owns no file paths, matching the old prover's contract.
 */
export async function prove(
    input: Record<string, unknown>,
    wasm: string | Uint8Array,
    zkey: string | Uint8Array,
): Promise<ProofBundle> {
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasm, zkey);
    return serializeProof(proof, publicSignals);
}
