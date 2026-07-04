import { deriveShieldedIdentity, type ShieldedIdentity } from "@shieldpass/sdk/dist/identity";
import { argon2idAsync } from "@noble/hashes/argon2.js";

const PRF_SALT = new TextEncoder().encode("shieldpass-prf-v3");
const RECOVERY_SALT = new TextEncoder().encode("shieldpass-recovery-v1");
const PASSWORD_SALT_PREFIX = "shieldpass-password-v1:";

function b64urlToBytes(s: string): Uint8Array {
  const b = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b + "=".repeat((4 - (b.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function pbkdf2Seed(secret: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: toArrayBuffer(salt), iterations, hash: "SHA-256" },
    keyMaterial,
    256,
  );
  return new Uint8Array(bits);
}

/** Derive the 32-byte shielded seed from the passkey via WebAuthn PRF. */
export async function deriveSeedFromPasskey(credentialIdB64?: string): Promise<Uint8Array> {
  if (typeof navigator === "undefined" || !navigator.credentials) {
    throw new Error("WebAuthn unavailable in this environment.");
  }
  const publicKey: any = {
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    allowCredentials: credentialIdB64 ? [{ id: toArrayBuffer(b64urlToBytes(credentialIdB64)), type: "public-key" }] : [],
    userVerification: "required",
    extensions: { prf: { eval: { first: toArrayBuffer(PRF_SALT) } } },
  };
  const assertion = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential | null;
  if (!assertion) throw new Error("Passkey assertion cancelled.");
  const prf = (assertion.getClientExtensionResults() as any).prf?.results?.first as ArrayBuffer | undefined;
  if (!prf) throw new Error("PRF unavailable");
  return new Uint8Array(prf);
}

export async function deriveSeedFromRecoveryPhrase(phrase: string): Promise<Uint8Array> {
  const normalized = phrase.trim();
  if (!normalized) throw new Error("Recovery phrase is required.");
  return pbkdf2Seed(normalized, RECOVERY_SALT, 210_000);
}

export async function deriveSeedFromPassword(password: string, email: string): Promise<Uint8Array> {
  const normalized = password.trim();
  if (!normalized) throw new Error("Password is required.");
  return argon2idAsync(
    new TextEncoder().encode(normalized),
    new TextEncoder().encode(`${PASSWORD_SALT_PREFIX}${email.trim().toLowerCase()}`),
    { t: 3, m: 64 * 1024, p: 1, dkLen: 32 },
  );
}

export function deriveIdentityFromSeed(seed: Uint8Array): ShieldedIdentity {
  return deriveShieldedIdentity(seed);
}

export async function deriveIdentityFromPasskey(credentialIdB64?: string): Promise<ShieldedIdentity> {
  return deriveIdentityFromSeed(await deriveSeedFromPasskey(credentialIdB64));
}

export async function deriveIdentityFromRecoveryPhrase(phrase: string): Promise<ShieldedIdentity> {
  return deriveIdentityFromSeed(await deriveSeedFromRecoveryPhrase(phrase));
}

export async function deriveIdentityFromPassword(password: string, email: string): Promise<ShieldedIdentity> {
  return deriveIdentityFromSeed(await deriveSeedFromPassword(password, email));
}

export type IdentitySource =
  | { kind: "passkey"; credentialId?: string }
  | { kind: "recovery"; phrase: string }
  | { kind: "password"; password: string; email: string };

export async function deriveIdentity(source: IdentitySource): Promise<ShieldedIdentity> {
  switch (source.kind) {
    case "passkey":
      return deriveIdentityFromPasskey(source.credentialId);
    case "recovery":
      return deriveIdentityFromRecoveryPhrase(source.phrase);
    case "password":
      return deriveIdentityFromPassword(source.password, source.email);
  }
}

export async function deriveSeed(source: IdentitySource): Promise<Uint8Array> {
  switch (source.kind) {
    case "passkey":
      return deriveSeedFromPasskey(source.credentialId);
    case "recovery":
      return deriveSeedFromRecoveryPhrase(source.phrase);
    case "password":
      return deriveSeedFromPassword(source.password, source.email);
  }
}

// ── Biometric (passkey) unlock for the shielded key ──────────────────────────
// The shielded seed stays PIN-derived (portable across devices, no server storage, logout-safe).
// For convenience we ALSO cache an AES-GCM-wrapped copy of that seed, encrypted under a key from
// the passkey's WebAuthn PRF, so the user can re-unlock with Face ID / fingerprint instead of
// typing the PIN. Device-local (localStorage); the PIN remains the portable source of truth.
// Best-effort: if the passkey/device doesn't support the PRF extension, no wrap is stored and the
// PIN is the only unlock. The wrap is a ciphertext, so caching it is safe.

const wrapKey = (email: string) => `shp_pkwrap_${email.trim().toLowerCase()}`;
const triedKey = (email: string) => `shp_pkwrap_tried_${email.trim().toLowerCase()}`;

function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function b64ToBytes(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

async function aesGcm(mode: "encrypt" | "decrypt", key: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", toArrayBuffer(key), "AES-GCM", false, [mode]);
  const params = { name: "AES-GCM", iv: toArrayBuffer(iv) };
  const out = mode === "encrypt"
    ? await crypto.subtle.encrypt(params, k, toArrayBuffer(data))
    : await crypto.subtle.decrypt(params, k, toArrayBuffer(data));
  return new Uint8Array(out);
}

/** True if this browser has a biometric (passkey) unlock enrolled for `email`. */
export function hasPasskeyUnlock(email: string): boolean {
  try { return !!localStorage.getItem(wrapKey(email)); } catch { return false; }
}

/**
 * Best-effort: wrap the PIN-derived seed under the passkey PRF so future unlocks can use Face ID /
 * fingerprint. Self-guards — no-op if already enrolled or already attempted on this device (so we
 * never nag on authenticators without PRF support). Returns true only if biometric unlock is now
 * available. Triggers a WebAuthn prompt when it actually attempts enrollment.
 */
export async function enrollPasskeyUnlock(seed: Uint8Array, email: string, credentialId?: string): Promise<boolean> {
  try {
    if (hasPasskeyUnlock(email)) return true;
    if (localStorage.getItem(triedKey(email))) return false;
    localStorage.setItem(triedKey(email), "1"); // one attempt per device — avoid repeated prompts
    const prfKey = await deriveSeedFromPasskey(credentialId); // biometric prompt + PRF eval
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await aesGcm("encrypt", prfKey, iv, seed);
    const blob = new Uint8Array(iv.length + ct.length);
    blob.set(iv); blob.set(ct, iv.length);
    localStorage.setItem(wrapKey(email), bytesToB64(blob));
    return true;
  } catch {
    return false; // PRF unsupported / cancelled — biometric unavailable, PIN still works
  }
}

/** Unlock the shielded seed with the passkey (Face ID / fingerprint) via the enrolled PRF wrap. */
export async function unlockSeedWithPasskey(email: string, credentialId?: string): Promise<Uint8Array> {
  let stored: string | null = null;
  try { stored = localStorage.getItem(wrapKey(email)); } catch { /* ignore */ }
  if (!stored) throw new Error("Biometric unlock isn't set up on this device — use your PIN.");
  const prfKey = await deriveSeedFromPasskey(credentialId); // biometric prompt + PRF eval
  const blob = b64ToBytes(stored);
  return aesGcm("decrypt", prfKey, blob.slice(0, 12), blob.slice(12));
}
