import { fiatMode, fiatModeError } from './fiatMode';

/**
 * Lenco Business Banking outward NGN payouts.
 *
 * Mock payouts are only enabled when FIAT_MODE=mock. In live mode, the Lenco key
 * and account id are required so real deployments cannot silently simulate fiat.
 */

const LENCO_API_KEY = process.env.LENCO_API_KEY || '';
const LENCO_API_URL = process.env.LENCO_API_URL || 'https://api.lenco.co/access/v1';
const LENCO_ACCOUNT_ID = process.env.LENCO_ACCOUNT_ID || '';

export interface LencoTransferInput {
  amountNaira: number;
  accountNumber: string;
  bankName: string;
  accountName: string;
  bankCode?: string;
  reference: string;
}

export interface LencoTransferResult {
  ok: boolean;
  transferId: string;
  status: 'successful' | 'pending' | 'failed';
  error?: string;
}

export async function initiateTransfer(input: LencoTransferInput): Promise<LencoTransferResult> {
  if (!(input.amountNaira > 0)) return { ok: false, transferId: '', status: 'failed', error: 'Amount must be positive.' };
  if (!input.accountNumber) return { ok: false, transferId: '', status: 'failed', error: 'accountNumber is required.' };

  const mode = fiatMode();
  if (!mode) return { ok: false, transferId: '', status: 'failed', error: fiatModeError('Lenco') };

  if (mode === 'mock') {
    const transferId = `mock_lenco_${input.reference}_${Date.now()}`;
    console.log(`[lenco] MOCK transfer NGN ${input.amountNaira} -> ${input.bankName} ${input.accountNumber} (${input.accountName})`);
    return { ok: true, transferId, status: 'successful' };
  }

  if (!LENCO_API_KEY || !LENCO_ACCOUNT_ID) {
    return { ok: false, transferId: '', status: 'failed', error: 'LENCO_API_KEY and LENCO_ACCOUNT_ID are required when FIAT_MODE=live.' };
  }

  try {
    // Lenco create-transfer: POST /transfer with a FLAT body (accountNumber + bankCode at top level),
    // amount as a STRING, and a reference limited to [A-Za-z0-9-._].
    const res = await fetch(`${LENCO_API_URL}/transfer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LENCO_API_KEY}` },
      body: JSON.stringify({
        accountId: LENCO_ACCOUNT_ID,
        amount: String(input.amountNaira),
        narration: `ShieldPass ${input.reference}`.slice(0, 100),
        reference: input.reference,
        accountNumber: input.accountNumber,
        bankCode: input.bankCode,
      }),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, transferId: '', status: 'failed', error: data?.message || `Lenco error ${res.status}` };
    }
    const d = data?.data ?? {};
    // request status is queued|created; transaction status is successful|pending|failed|declined|reversed
    const raw = String(d?.transaction?.status || d?.request?.status || 'pending').toLowerCase();
    const status: LencoTransferResult['status'] =
      raw === 'successful' ? 'successful'
        : (raw === 'failed' || raw === 'declined' || raw === 'reversed') ? 'failed'
          : 'pending';
    const transferId = String(d?.transaction?.id || d?.request?.id || d?.id || input.reference);
    return { ok: status !== 'failed', transferId, status };
  } catch (err) {
    return { ok: false, transferId: '', status: 'failed', error: err instanceof Error ? err.message : String(err) };
  }
}

export interface ResolveResult { ok: boolean; accountName?: string; error?: string }

/**
 * Name enquiry: resolve an account number + bank code to the account holder's name so the user can
 * confirm the recipient BEFORE paying (prevents sending to the wrong account). In mock mode we
 * return a placeholder so the flow is testable without live credentials.
 */
export async function resolveAccount(accountNumber: string, bankCode: string): Promise<ResolveResult> {
  const mode = fiatMode();
  if (mode === 'mock') return { ok: true, accountName: 'TEST RECIPIENT (mock)' };
  if (!LENCO_API_KEY) return { ok: false, error: 'LENCO_API_KEY is required to resolve account names.' };
  try {
    const url = `${LENCO_API_URL}/resolve?accountNumber=${encodeURIComponent(accountNumber)}&bankCode=${encodeURIComponent(bankCode)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${LENCO_API_KEY}` } });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.message || `Lenco resolve failed (${res.status})` };
    const name = data?.data?.accountName ?? data?.data?.name ?? data?.accountName ?? data?.name;
    if (!name) return { ok: false, error: 'Could not resolve account name for that number + bank.' };
    return { ok: true, accountName: String(name) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

let _banksCache: { code: string; name: string }[] | null = null;

/**
 * Lenco's bank list — the source of truth for bank codes (Lenco uses 6-digit NIP codes like
 * "000023", NOT the 3-digit CBN codes). The withdraw form must use these so /resolve and /transfer
 * receive a code Lenco accepts. Cached in memory for the process lifetime.
 */
export async function getBanks(): Promise<{ code: string; name: string }[]> {
  if (_banksCache) return _banksCache;
  if (!LENCO_API_KEY) return [];
  try {
    const res = await fetch(`${LENCO_API_URL}/banks`, { headers: { Authorization: `Bearer ${LENCO_API_KEY}` } });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok || !Array.isArray(data?.data)) return [];
    _banksCache = data.data.map((b: any) => ({ code: String(b.code), name: String(b.name) }));
    return _banksCache!;
  } catch {
    return [];
  }
}
