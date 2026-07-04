/**
 * ShieldPass SDK — shared helpers
 * Single home for validators reused across the client, the Stellar layer,
 * and the backend (which imports them from the built SDK).
 */

/** Validates a Stellar public key (G... address, 56 chars). */
export function isValidStellarAddress(address: string): boolean {
    return typeof address === 'string' && /^G[A-Z2-7]{55}$/.test(address);
}

/** Validates a Soroban address: a classic account (G...) OR a contract account (C...), 56 chars. */
export function isValidSorobanAddress(address: string): boolean {
    return typeof address === 'string' && /^[GC][A-Z2-7]{55}$/.test(address);
}

/** Encodes proof bytes as a 0x-prefixed hex string for JSON transport. */
export function proofToHex(proof: Uint8Array): string {
    return '0x' + Array.from(proof).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Decodes a 0x-prefixed hex string back into proof bytes. */
export function hexToProof(hex: string): Uint8Array {
    const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
    if (clean.length % 2 !== 0) throw new Error('[utils] hex string has odd length.');
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    return out;
}
