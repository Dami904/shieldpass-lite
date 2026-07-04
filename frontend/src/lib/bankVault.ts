import type { BankAccount } from "../types";

const DB_NAME = "shieldpass-bank-vault";
const STORE_NAME = "records";
const VAULT_LABEL = "shieldpass-bank-vault-v1";

type VaultRecord = {
  email: string;
  payload: string;
  iv: string;
  updatedAt: string;
};

type VaultState = {
  banks: BankAccount[];
};

let vaultKey: CryptoKey | null = null;
let vaultEmail: string | null = null;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: "email" });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function readRecord(email: string): Promise<VaultRecord | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(email);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve((req.result as VaultRecord | undefined) ?? null);
  });
}

async function writeRecord(record: VaultRecord): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).put(record);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deriveVaultKey(seed: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", toArrayBuffer(seed), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode(VAULT_LABEL),
      info: new TextEncoder().encode("bank-details"),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptJson(value: unknown, key: CryptoKey): Promise<{ payload: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(value));
  const payload = await crypto.subtle.encrypt({ name: "AES-GCM", iv: toArrayBuffer(iv) }, key, data);
  return { payload: bytesToBase64(new Uint8Array(payload)), iv: bytesToBase64(iv) };
}

async function decryptJson<T>(record: VaultRecord, key: CryptoKey): Promise<T> {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(base64ToBytes(record.iv)) },
    key,
    toArrayBuffer(base64ToBytes(record.payload)),
  );
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}

function blankVault(): VaultState {
  return { banks: [] };
}

function normalizeVault(value: unknown): VaultState {
  if (Array.isArray(value)) {
    return { banks: value as BankAccount[] };
  }
  if (value && typeof value === "object") {
    const maybe = value as Partial<VaultState>;
    return {
      banks: Array.isArray(maybe.banks) ? maybe.banks : [],
    };
  }
  return blankVault();
}

async function loadVault(email: string): Promise<VaultState> {
  const scope = email.trim().toLowerCase();
  if (!vaultKey || vaultEmail !== scope) return blankVault();
  const record = await readRecord(scope);
  if (!record) return blankVault();
  return normalizeVault(await decryptJson<unknown>(record, vaultKey));
}

async function saveVault(email: string, vault: VaultState): Promise<void> {
  const scope = email.trim().toLowerCase();
  if (!vaultKey || vaultEmail !== scope) throw new Error("Bank vault is locked.");
  const encrypted = await encryptJson(vault, vaultKey);
  await writeRecord({ email: scope, ...encrypted, updatedAt: new Date().toISOString() });
}

export async function unlockBankVault(seed: Uint8Array, email: string): Promise<void> {
  vaultKey = await deriveVaultKey(seed);
  vaultEmail = email.trim().toLowerCase();
}

export function lockBankVault(): void {
  vaultKey = null;
  vaultEmail = null;
}

export async function loadBanks(email: string): Promise<BankAccount[]> {
  const vault = await loadVault(email);
  return vault.banks;
}

export async function saveBanks(email: string, banks: BankAccount[]): Promise<void> {
  const vault = await loadVault(email);
  await saveVault(email, { ...vault, banks });
}

export async function addBank(email: string, bank: BankAccount): Promise<BankAccount[]> {
  const existing = await loadBanks(email);
  const next = [...existing.filter((b) => b.id !== bank.id), bank];
  await saveBanks(email, next);
  return next;
}
