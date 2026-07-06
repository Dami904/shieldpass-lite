import type { Quote, SwapRecord } from "../types";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || errData.message || `API error: ${res.status}`);
  }
  return res.json();
}

export const api = {
  verifyWeb3Auth: (input: { idToken: string }) =>
    request<{ email: string; providerSub?: string }>("/auth/web3auth", { method: "POST", body: JSON.stringify(input) }),

  linkWallet: (input: {
    email: string; pin?: string; smartWalletAddress: string; passkeyKeyId?: string;
    shieldedOwner?: string; shieldedEncPub?: string; shieldedAddress?: string; socialSub?: string;
  }) =>
    request<{
      success: boolean; tier: number; secretSalt: string; merkleRoot: string; leafIndex: number;
      // The faucet (new accounts only) settles on-chain in the BACKGROUND. When pending, the
      // client keeps `faucetSecret` and polls faucetStatus; the shielded 500 is only shown once
      // it settles (hide-until-settled). Absent for returning accounts.
      faucetPending?: boolean;
      faucetSecret?: {
        amount: string; randomness: string; asset: string; commitment: string;
        compliance: { hardware_attested: string; bvn_verified: string; good_standing: string };
      };
    }>("/kyc/link-wallet", { method: "POST", body: JSON.stringify(input) }),

  // Poll the background faucet settlement. 'settled' returns the reserved leaf + circuit input so
  // the client can generate the merkle_insert proof; 'pending' means still settling.
  faucetStatus: (commitment: string) =>
    request<
      | { state: "pending" }
      | { state: "settled"; leafIndex: number; circuitInput: Record<string, unknown> }
    >(`/kyc/faucet-status?commitment=${encodeURIComponent(commitment)}`),

  submitBvn: (input: { email: string; phone?: string; bvn: string }) =>
    request<{ success: boolean; tier: number; returnedName: string; secretSalt: string; merkleRoot: string; leafIndex: number }>(
      "/kyc/submit-bvn", { method: "POST", body: JSON.stringify(input) }),

  verifyPin: (input: { email: string; pin: string }) =>
    request<{ ok: boolean; passkeyKeyId?: string; smartWalletAddress?: string }>("/kyc/verify-pin", { method: "POST", body: JSON.stringify(input) }),

  getAccount: (wallet: string) =>
    request<{ email: string; bvnVerified: boolean }>(
      `/kyc/account?wallet=${encodeURIComponent(wallet)}`),

  reissueSalt: (input: { email: string; pin: string }) =>
    request<{ success: boolean; bvnVerified: boolean; secretSalt: string; merkleRoot: string; leafIndex: number }>(
      "/kyc/reissue-salt", { method: "POST", body: JSON.stringify(input) }),

  quote: (input: { tokenAddress: string; cryptoAmount: number; assetCode?: string }) =>
    request<Quote>("/swap/quote", { method: "POST", body: JSON.stringify(input) }),

  // Name enquiry: account number + bank code -> account holder name (confirm recipient before paying).
  resolveAccount: (input: { accountNumber: string; bankCode: string }) =>
    request<{ accountName: string }>("/swap/resolve-account", { method: "POST", body: JSON.stringify(input) }),

  // Lenco's full supported bank list (correct 6-digit codes) for the withdraw bank picker.
  banks: () => request<{ banks: { code: string; name: string }[] }>("/swap/banks"),

  executeSwap: (input: {
    email: string;
    ephemeralBankDetails: { accountNumber: string; bankName: string; accountName: string; bankCode?: string };
    tokenAddress: string; cryptoAmount: number; cryptoAmountUnits: string; assetCode?: string;
    onChainSwapId: string; nullifier?: string; changeCommitment?: string;
  }) => request<{ success: boolean; swap: SwapRecord; changeLeafIndex: number | null; payout: { amountNaira: number; bank: string; transferId: string }; message: string }>(
    "/swap/execute", { method: "POST", body: JSON.stringify(input) }),

  swapHistory: (email: string) =>
    request<SwapRecord[]>(`/swap/history?email=${encodeURIComponent(email)}`),

  // ── Shielded tree: two-step client-side insert ──
  // `pool` is the shielded_pool contract id whose tree this leaf belongs to (one tree per
  // asset). Omitted → backend uses the default (XLM) pool, so faucet/legacy calls still work.
  // Step 1: reserve index + get circuit input
  treeAssign: (commitment: string, pool?: string) =>
    request<{ index: number; circuitInput: Record<string, unknown> }>("/tree/assign", { method: "POST", body: JSON.stringify({ commitment, pool }) }),
  // Step 2: send browser-generated proof, backend submits on-chain
  treeConfirm: (index: number, proof: {
    proof_a: number[]; proof_b: number[]; proof_c: number[]; public_signals: number[][];
  }, pool?: string) =>
    request<{ txHash?: string }>("/tree/confirm", { method: "POST", body: JSON.stringify({ index, ...proof, pool }) }),
  // Retry a stuck pending proof: returns circuitInput if still pending, or { status: 'confirmed' }
  treeRetry: (index: number, pool?: string) =>
    request<{ status: 'confirmed' } | { status: 'pending'; index: number; circuitInput: Record<string, unknown> }>(
      `/tree/retry/${index}${pool ? `?pool=${encodeURIComponent(pool)}` : ''}`),

  lookupShielded: (email: string) =>
    request<{ owner: string; encPub: string; address: string | null }>(`/notes/identity/${encodeURIComponent(email)}`),
  postNoteBlob: (input: { commitment: string; ephemeralPub: string; ciphertext: string }) =>
    request<{ id: number }>("/notes/blob", { method: "POST", body: JSON.stringify(input) }),
  scanNotes: (cursor: number) =>
    request<{ blobs: { id: number; commitment: string; ephemeralPub: string; ciphertext: string }[]; nextCursor: number }>(
      `/notes/since/${cursor}`),
  treeIndexOf: (commitment: string, pool?: string) =>
    request<{ index: number }>(`/tree/index/${commitment}${pool ? `?pool=${encodeURIComponent(pool)}` : ''}`),

  notify: (input: { email: string; type: string; title: string; amount?: string; asset?: string; body?: string; txHash?: string }) =>
    request<{ ok: boolean }>("/notifications", { method: "POST", body: JSON.stringify(input) }),
  listNotifications: (email: string) =>
    request<{ items: NotificationItem[]; unread: number }>(`/notifications?email=${encodeURIComponent(email)}`),
  markNotificationsRead: (email: string) =>
    request<{ ok: boolean }>("/notifications/read", { method: "POST", body: JSON.stringify({ email }) }),
};

export interface NotificationItem {
  id: string; type: string; title: string; body?: string;
  amount?: string; asset?: string; txHash?: string; read: boolean; createdAt: string;
}
