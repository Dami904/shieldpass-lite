import { fiatMode, fiatModeError } from './fiatMode';
import { logger } from '../logger';

/**
 * Paystack outward NGN payouts.
 *
 * Mock payouts are only enabled when FIAT_MODE=mock. In live mode, a Paystack key
 * is required so staging/production cannot silently simulate successful payouts.
 */

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || '';

export interface FiatTransferInput {
  amountNaira: number;
  accountNumber: string;
  bankName: string;
  accountName: string;
  bankCode?: string;
  reference: string;
}

export interface FiatTransferResult {
  ok: boolean;
  transferId: string;
  status: 'successful' | 'pending' | 'failed';
  error?: string;
}

export async function initiatePaystackTransfer(input: FiatTransferInput): Promise<FiatTransferResult> {
  if (!(input.amountNaira > 0)) return { ok: false, transferId: '', status: 'failed', error: 'Amount must be positive.' };
  if (!input.accountNumber) return { ok: false, transferId: '', status: 'failed', error: 'accountNumber is required.' };
  if (!input.bankCode) return { ok: false, transferId: '', status: 'failed', error: 'bankCode is required for Paystack transfers.' };

  const mode = fiatMode();
  if (!mode) return { ok: false, transferId: '', status: 'failed', error: fiatModeError('Paystack') };

  if (mode === 'mock') {
    const transferId = `mock_paystack_${input.reference}_${Date.now()}`;
    logger.info({ amountNaira: input.amountNaira, bankName: input.bankName, accountNumber: input.accountNumber }, '[paystack] MOCK transfer');
    return { ok: true, transferId, status: 'successful' };
  }

  if (!PAYSTACK_SECRET_KEY) {
    return { ok: false, transferId: '', status: 'failed', error: 'PAYSTACK_SECRET_KEY is required when FIAT_MODE=live.' };
  }

  try {
    const rcptRes = await fetch('https://api.paystack.co/transferrecipient', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
      body: JSON.stringify({
        type: 'nuban',
        name: input.accountName,
        account_number: input.accountNumber,
        bank_code: input.bankCode,
        currency: 'NGN',
      }),
    });
    const rcptData = await rcptRes.json();
    if (!rcptData.status) {
      return { ok: false, transferId: '', status: 'failed', error: rcptData.message || 'Failed to create Paystack recipient' };
    }

    const trfRes = await fetch('https://api.paystack.co/transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
      body: JSON.stringify({
        source: 'balance',
        amount: Math.round(input.amountNaira * 100),
        recipient: rcptData.data.recipient_code,
        reason: `ShieldPass swap ${input.reference}`,
        reference: input.reference,
      }),
    });
    const trfData = await trfRes.json();
    if (!trfData.status) {
      return { ok: false, transferId: '', status: 'failed', error: trfData.message || 'Failed to initiate Paystack transfer' };
    }

    const tx = trfData.data;
    const paystackStatus = tx.status === 'success' ? 'successful' : tx.status === 'failed' ? 'failed' : 'pending';
    return { ok: paystackStatus !== 'failed', transferId: String(tx.transfer_code || input.reference), status: paystackStatus };
  } catch (err) {
    return { ok: false, transferId: '', status: 'failed', error: err instanceof Error ? err.message : String(err) };
  }
}
