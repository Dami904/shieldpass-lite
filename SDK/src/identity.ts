import { x25519 } from '@noble/curves/ed25519.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { ownerOf } from './notes';

// BN254 scalar field order.
export const FIELD_ORDER =
    21888242871839275222246405745257275088548364400416034343698204186575808495617n;

function bytesToField(b: Uint8Array): bigint {
    let x = 0n;
    for (const byte of b) x = (x << 8n) | BigInt(byte);
    return x % FIELD_ORDER;
}
function fieldTo32(x: bigint): Uint8Array {
    const h = (x % FIELD_ORDER).toString(16).padStart(64, '0');
    return Uint8Array.from(h.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
}
// base64url without relying on Buffer's 'base64url' encoding (unsupported by the browser
// `buffer` polyfill) — use standard base64 + URL-safe char swap.
const b64url = (u8: Uint8Array) =>
    Buffer.from(u8).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string) => {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
    return new Uint8Array(Buffer.from(b64, 'base64'));
};
const utf8 = (s: string) => new TextEncoder().encode(s);

export interface ShieldedIdentity {
    sk: bigint;           // shielded spending key (BN254 scalar)
    owner: bigint;        // Poseidon(DOM_OWNER, sk)
    encSecret: Uint8Array; // x25519 private (note decryption)
    encPublic: Uint8Array; // x25519 public
    address: string;      // shareable "shp_…"
}

/** Derive the full shielded identity from a 32-byte seed (e.g. passkey PRF output). */
export function deriveShieldedIdentity(seed: Uint8Array): ShieldedIdentity {
    const sk = bytesToField(hkdf(sha256, seed, undefined, utf8('shieldpass-sk-v2'), 32));
    const owner = ownerOf(sk);
    const encSecret = hkdf(sha256, seed, undefined, utf8('shieldpass-enc-v2'), 32);
    const encPublic = x25519.getPublicKey(encSecret);
    return { sk, owner, encSecret, encPublic, address: encodeAddress(owner, encPublic) };
}

/** Shielded address = "shp_" + base64url(owner32 ‖ encPublic32). */
export function encodeAddress(owner: bigint, encPublic: Uint8Array): string {
    const buf = new Uint8Array(64);
    buf.set(fieldTo32(owner), 0);
    buf.set(encPublic, 32);
    return 'shp_' + b64url(buf);
}
export function decodeAddress(addr: string): { owner: bigint; encPublic: Uint8Array } {
    if (!addr.startsWith('shp_')) throw new Error('invalid shielded address');
    const buf = fromB64url(addr.slice(4));
    if (buf.length !== 64) throw new Error('invalid shielded address length');
    return { owner: bytesToField(buf.subarray(0, 32)), encPublic: buf.subarray(32, 64) };
}

/** Encrypt a note blob to a recipient's encPublic (x25519 ECDH + XChaCha20-Poly1305). */
export function encryptNote(recipientEncPublic: Uint8Array, plaintext: Uint8Array): {
    ephemeralPublic: Uint8Array; ciphertext: Uint8Array;
} {
    const ephSecret = x25519.utils.randomSecretKey();
    const ephemeralPublic = x25519.getPublicKey(ephSecret);
    const shared = x25519.getSharedSecret(ephSecret, recipientEncPublic);
    const key = hkdf(sha256, shared, undefined, utf8('shieldpass-note'), 32);
    const nonce = randomBytes(24);
    const ct = xchacha20poly1305(key, nonce).encrypt(plaintext);
    const ciphertext = new Uint8Array(nonce.length + ct.length);
    ciphertext.set(nonce, 0); ciphertext.set(ct, nonce.length);
    return { ephemeralPublic, ciphertext };
}
export function decryptNote(encSecret: Uint8Array, ephemeralPublic: Uint8Array, ciphertext: Uint8Array): Uint8Array {
    const shared = x25519.getSharedSecret(encSecret, ephemeralPublic);
    const key = hkdf(sha256, shared, undefined, utf8('shieldpass-note'), 32);
    return xchacha20poly1305(key, ciphertext.subarray(0, 24)).decrypt(ciphertext.subarray(24));
}

/** A random BN254 field element (for note randomness, etc.). */
export function randomField(): bigint {
    return bytesToField(randomBytes(32));
}
