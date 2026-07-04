import { Router } from 'express';
import { Networks, Keypair } from '@stellar/stellar-sdk';
import { ShieldedPoolClient } from '@shieldpass/sdk';
import { Prisma } from '../generated/prisma/client';
import { prisma } from '../db';
import { burnNullifier } from '../services/compliance';
import { treeServiceFor } from '../services/tree';
import { poolIdForAsset, defaultPoolId } from '../services/pools';
import { notify } from './notifications';
import { getQuote, TIER2_THRESHOLD_NAIRA, type Quote } from '../services/quote';
import { initiateTransfer as initiateLencoTransfer, resolveAccount, getBanks, type LencoTransferResult } from '../services/lenco';
import { initiatePaystackTransfer } from '../services/paystack';
import { accountLookupLimiter } from '../middleware/rateLimit';

const router = Router();

const RPC_URL = process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org';
const NETWORK = process.env.STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET;

const SwapStatus = {
  FIAT_PROCESSING: 'FIAT_PROCESSING',
  FIAT_PENDING: 'FIAT_PENDING',
  FIAT_FAILED_REFUND_PENDING: 'FIAT_FAILED_REFUND_PENDING',
  FIAT_SENT_CLAIM_PENDING: 'FIAT_SENT_CLAIM_PENDING',
  COMPLETED: 'COMPLETED',
} as const;

function nairaToKobo(amountNaira: number): string {
  return String(Math.round(amountNaira * 100));
}

function cryptoUnits(value: unknown): string | null {
  try {
    return BigInt(String(value)).toString();
  } catch {
    return null;
  }
}

function chainConfig() {
  return {
    contractId: process.env.STELLAR_CONTRACT_ID || '',
    relayerSecret: process.env.STELLAR_RELAYER_SECRET || '',
    rpcUrl: process.env.STELLAR_RPC_URL || RPC_URL,
    network: process.env.STELLAR_NETWORK_PASSPHRASE || NETWORK,
  };
}

const NIGERIAN_BANKS = [
  { code: "044", name: "Access Bank" }, { code: "050", name: "Ecobank" },
  { code: "011", name: "First Bank" }, { code: "058", name: "GTBank" },
  { code: "50211", name: "Kuda" }, { code: "50515", name: "Moniepoint" },
  { code: "999992", name: "OPay" }, { code: "033", name: "UBA" },
  { code: "057", name: "Zenith Bank" },
];

// POST /swap/quote - Naira payout for any Stellar asset + whether it needs Tier 2 (BVN).
// GET /swap/banks - Lenco's bank list (correct 6-digit codes) for the withdraw form's bank picker.
router.get('/banks', async (_req, res) => {
  try {
    const banks = await getBanks();
    return res.json({ banks });
  } catch (err) {
    console.error('[swap/banks]', err);
    return res.status(500).json({ error: 'Could not load banks.' });
  }
});

// POST /swap/resolve-account - name enquiry: resolve account number + bank code to the account
// holder's name so the user can confirm the recipient BEFORE paying (prevents wrong-account payouts).
router.post('/resolve-account', accountLookupLimiter, async (req, res) => {
  const { accountNumber, bankCode } = req.body;
  if (!/^\d{10}$/.test(String(accountNumber || ''))) return res.status(400).json({ error: 'A valid 10-digit account number is required.' });
  if (!bankCode) return res.status(400).json({ error: 'bankCode is required.' });
  const r = await resolveAccount(String(accountNumber), String(bankCode));
  if (!r.ok) return res.status(422).json({ error: r.error });
  return res.json({ accountName: r.accountName });
});

router.post('/quote', async (req, res) => {
  const { tokenAddress, cryptoAmount, assetCode } = req.body;
  if (!tokenAddress) return res.status(400).json({ error: 'tokenAddress is required.' });
  if (!(Number(cryptoAmount) > 0)) return res.status(400).json({ error: 'cryptoAmount must be a positive number.' });

  try {
    const quote = await getQuote(String(tokenAddress), Number(cryptoAmount), assetCode);
    const requireBvn = quote.nairaAmount > TIER2_THRESHOLD_NAIRA;
    res.json({ ...quote, requireBvn, tier2ThresholdNaira: TIER2_THRESHOLD_NAIRA });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Could not quote swap.' });
  }
});

// POST /execute - the core off-ramp orchestration (trustless shielded-pool flow).
// The ZK proof was already verified ON-CHAIN by the client's `confidential_swap`
// call (which burned the note's nullifier, enforced the tier, and recorded a
// pending payout under `onChainSwapId`). The backend therefore only:
//   1) pays the Naira via Paystack/Lenco  2) calls `claim_swap(onChainSwapId)`
// to sweep the swapped crypto to the treasury. No off-chain verification, no
// fabricated settlement proof.
router.post('/execute', async (req, res) => {
  const { email, ephemeralBankDetails, tokenAddress, cryptoAmount, cryptoAmountUnits, assetCode, onChainSwapId, nullifier, changeCommitment } = req.body;

  if (!email || !ephemeralBankDetails || !tokenAddress || onChainSwapId === undefined || onChainSwapId === null) {
    return res.status(400).json({ error: 'email, ephemeralBankDetails, tokenAddress and onChainSwapId are required.' });
  }
  if (!(Number(cryptoAmount) > 0)) return res.status(400).json({ error: 'cryptoAmount must be a positive number.' });
  const exactCryptoUnits = cryptoUnits(cryptoAmountUnits ?? cryptoAmount);
  if (!exactCryptoUnits) return res.status(400).json({ error: 'cryptoAmountUnits must be an integer string.' });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.status(404).json({ error: 'No account for that email.' });

  // Replay guard: an on-chain swap id may only ever be paid out once. This is a fast-path
  // check; the DB's unique constraint on swapId is what actually closes the race if two
  // requests for the same id land concurrently (caught below on create).
  if (await prisma.swap.findUnique({ where: { swapId: String(onChainSwapId) } })) {
    return res.status(409).json({ error: 'This swap has already been processed.' });
  }

  // ZERO-STORAGE ARCHITECTURE:
  // We do not save or look up the bank account in the DB.
  // We use the ephemeral details passed directly from the client's local storage.
  const { accountNumber, bankName, accountName } = ephemeralBankDetails;
  // Lenco/Paystack bank code — prefer the one the client resolved against Lenco's list (6-digit),
  // falling back to a name lookup for legacy saved banks.
  const bankCode: string | undefined = ephemeralBankDetails.bankCode || NIGERIAN_BANKS.find(b => b.name === bankName)?.code;

  // 1. Verify against on-chain truth: `cryptoAmount`/`cryptoAmountUnits` above are still just
  // what the CLIENT claims. The contract's `confidential_swap` call already recorded the real,
  // proof-verified amount under `onChainSwapId` (PayoutDetails.amount) — so when a pool is
  // configured we price and pay off THAT, never off client input. A tampered/replayed request
  // can at most match the on-chain amount, never inflate it.
  let verifiedCryptoAmount = Number(cryptoAmount);
  let verifiedCryptoUnits = exactCryptoUnits;
  const cfgForVerify = chainConfig();
  const poolIdForVerify = poolIdForAsset(String(assetCode)) || cfgForVerify.contractId;
  // Same "is chain actually configured" gate used below for claim_swap: relayerSecret is
  // read live from env on every call, whereas poolIdForVerify comes from a registry built
  // once at process start, so relayerSecret is the reliable signal in dev/test.
  if (poolIdForVerify && cfgForVerify.relayerSecret) {
    let payout;
    try {
      const pool = new ShieldedPoolClient(cfgForVerify.rpcUrl, cfgForVerify.network, poolIdForVerify);
      payout = await pool.getPayout(BigInt(onChainSwapId));
    } catch (err) {
      console.error('[swap/execute] get_payout lookup failed:', err);
      return res.status(404).json({ error: 'No matching on-chain swap found for that id.' });
    }
    if (payout.status !== 'Pending') {
      return res.status(409).json({ error: `This swap is already ${payout.status.toLowerCase()} on-chain.` });
    }
    verifiedCryptoUnits = payout.amount.toString();
    verifiedCryptoAmount = Number(payout.amount) / 1e7; // Stellar assets use 7 decimals (stroops)
  }

  // 2. Price the swap (the contract already enforced the tier gate on-chain).
  let quote: Quote;
  try {
    quote = await getQuote(String(tokenAddress), verifiedCryptoAmount, assetCode);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Could not quote swap.' });
  }

  // Record the swap as fiat-processing before moving fiat.
  // Note: bankAccountId is nullified in DB structure per Zero-Storage architecture.
  let swap;
  try {
    swap = await prisma.swap.create({
      data: {
        userId: user.id, tokenAddress: String(tokenAddress),
        assetCode: quote.assetCode, tokenLabel: quote.tokenLabel,
        cryptoAmount: verifiedCryptoAmount, nairaAmount: quote.nairaAmount,
        cryptoAmountUnits: verifiedCryptoUnits, nairaAmountKobo: nairaToKobo(quote.nairaAmount),
        quoteRateNaira: quote.rate, quoteSource: quote.source, quotedAt: new Date(quote.updatedAt),
        status: SwapStatus.FIAT_PROCESSING, swapId: String(onChainSwapId),
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return res.status(409).json({ error: 'This swap has already been processed.' });
    }
    throw err;
  }

  // 3. Pay the Naira out to the user's bank account ephemerally.
  // Lenco is the primary payout provider; Paystack is the fallback if Lenco fails.
  let transfer: LencoTransferResult = await initiateLencoTransfer({
    amountNaira: quote.nairaAmount,
    accountNumber: accountNumber,
    bankCode: bankCode,
    bankName: bankName,
    accountName: accountName,
    reference: `lc_${swap.id}`,
  });

  let processorUsed = 'Lenco';

  if (!transfer.ok || transfer.status === 'failed') {
    console.warn(`[swap/execute] Lenco failed: ${transfer.error}. Falling back to Paystack...`);
    transfer = await initiatePaystackTransfer({
      amountNaira: quote.nairaAmount,
      accountNumber: accountNumber,
      bankCode: bankCode,
      bankName: bankName,
      accountName: accountName,
      reference: `ps_${swap.id}`,
    });
    processorUsed = 'Paystack';
  }

  if (!transfer.ok || transfer.status === 'failed') {
    // Both fiat providers failed - leave the crypto locked. The user can refund after the on-chain time-lock.
    await prisma.swap.update({ where: { id: swap.id }, data: { status: SwapStatus.FIAT_FAILED_REFUND_PENDING } });
    return res.status(502).json({ error: `Fiat payout failed on all providers: ${transfer.error || 'unknown error'}. Your crypto stays locked and is refundable after the time-lock.` });
  }
  if (transfer.status === 'pending') {
    const pending = await prisma.swap.update({
      where: { id: swap.id },
      data: { lencoTransferId: transfer.transferId, status: SwapStatus.FIAT_PENDING },
    });
    return res.status(202).json({
      success: false,
      swap: pending,
      changeLeafIndex: null,
      payout: { amountNaira: quote.nairaAmount, bank: `${bankName} ${accountNumber}`, transferId: transfer.transferId, processor: processorUsed },
      message: `Naira payout is pending with ${processorUsed}. The crypto claim will run after settlement is confirmed.`,
    });
  }
  await prisma.swap.update({
    where: { id: swap.id },
    data: { lencoTransferId: transfer.transferId, status: SwapStatus.FIAT_SENT_CLAIM_PENDING },
  });

  // 4. Fiat settled - record the spent nullifier (the contract is the authority;
  // this is a convenience index) and claim the swapped crypto into the treasury.
  if (nullifier) await burnNullifier(String(nullifier), user.smartWalletAddress || email, 'swap');

  let txHash: string | null = null;
  const cfg = chainConfig();
  // Claim must hit the SAME pool the user swapped from — resolve it by asset
  // (each asset has its own shielded_pool); default to the XLM pool.
  const poolId = poolIdForAsset(String(assetCode)) || cfg.contractId;
  if (poolId && cfg.relayerSecret) {
    try {
      // Admin sweeps the pending payout to the treasury. Only a successful claim
      // marks the swap completed; otherwise it remains claim-pending for retry.
      const pool = new ShieldedPoolClient(cfg.rpcUrl, cfg.network, poolId);
      txHash = await pool.claimSwap(BigInt(onChainSwapId), Keypair.fromSecret(cfg.relayerSecret));
    } catch (err) {
      console.error('[swap/execute] claim_swap failed (fiat already paid):', err);
    }
  } else {
    console.warn('[swap/execute] claim_swap skipped: STELLAR_CONTRACT_ID/STELLAR_RELAYER_SECRET not configured.');
  }

  const completed = await prisma.swap.update({
    where: { id: swap.id },
    data: {
      status: txHash ? SwapStatus.COMPLETED : SwapStatus.FIAT_SENT_CLAIM_PENDING,
      txHash: txHash ?? undefined,
    },
  });
  await notify(email, 'WITHDRAW_FIAT', `NGN ${quote.nairaAmount.toLocaleString()} sent to ${bankName}`, { amount: String(quote.nairaAmount), asset: 'NGN' });

  // 5. The change note was queued on-chain by confidential_swap, but it is NOT inserted here.
  // The browser runs the full merkle_insert (assign -> prove -> confirm) via useInsertProof, so
  // the change leaf actually LANDS on-chain and the backend tree only advances once it's confirmed.
  // (Previously we pre-assigned the leaf here without ever landing it, which drifted the tree.)
  res.json({
    success: true,
    swap: completed,
    changeLeafIndex: null,
    payout: { amountNaira: quote.nairaAmount, bank: `${bankName} ${accountNumber}`, transferId: transfer.transferId, processor: processorUsed },
    message: `NGN ${quote.nairaAmount.toLocaleString()} sent to ${bankName} ${accountNumber}. (Bank Details deleted from memory)`,
  });
});

// GET /swap/history?email= - a user's swap history.
router.get('/history', async (req, res) => {
  const email = String(req.query.email || '');
  if (!email) return res.status(400).json({ error: 'email query param is required.' });
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.status(404).json({ error: 'No account for that email.' });
  const swaps = await prisma.swap.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } });
  res.json(swaps);
});

export default router;
