import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

// getPayout/claimSwap are shared mocks so each test can set its own on-chain response;
// vi.hoisted is required because vi.mock's factory runs before these const declarations.
const { getPayoutMock, claimSwapMock } = vi.hoisted(() => ({
  getPayoutMock: vi.fn(),
  claimSwapMock: vi.fn(),
}));

vi.mock('@shieldpass/sdk', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@shieldpass/sdk');
  return {
    ...actual,
    ShieldedPoolClient: vi.fn().mockImplementation(() => ({
      getPayout: getPayoutMock,
      claimSwap: claimSwapMock,
    })),
  };
});

import { app } from '../app';
import { prisma } from '../db';

const touchedEmails: string[] = [];
const originalFiatMode = process.env.FIAT_MODE;
const originalPaystackKey = process.env.PAYSTACK_SECRET_KEY;
const originalLencoKey = process.env.LENCO_API_KEY;
const originalLencoAccount = process.env.LENCO_ACCOUNT_ID;
const originalContractId = process.env.STELLAR_CONTRACT_ID;
const originalRelayerSecret = process.env.STELLAR_RELAYER_SECRET;
const originalSwapPriceMode = process.env.SWAP_PRICE_MODE;

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

async function createUser(email: string) {
  touchedEmails.push(email);
  return prisma.user.create({ data: { email } });
}

afterEach(async () => {
  restoreEnv('FIAT_MODE', originalFiatMode);
  restoreEnv('PAYSTACK_SECRET_KEY', originalPaystackKey);
  restoreEnv('LENCO_API_KEY', originalLencoKey);
  restoreEnv('LENCO_ACCOUNT_ID', originalLencoAccount);
  restoreEnv('STELLAR_CONTRACT_ID', originalContractId);
  restoreEnv('STELLAR_RELAYER_SECRET', originalRelayerSecret);
  restoreEnv('SWAP_PRICE_MODE', originalSwapPriceMode);
  getPayoutMock.mockReset();
  claimSwapMock.mockReset();

  for (const email of touchedEmails) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) continue;
    await prisma.notification.deleteMany({ where: { email } });
    await prisma.swap.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
  touchedEmails.length = 0;
});

describe('POST /swap/execute state accounting', () => {
  // swapId is unique per row (one payout per on-chain swap, ever), so each call needs its
  // own id — a fixed literal here would collide with any other row that ever used it.
  let nextSwapId = Date.now();
  const body = (email: string) => ({
    email,
    ephemeralBankDetails: {
      accountNumber: '0123456789',
      bankName: 'Access Bank',
      accountName: 'Test User',
    },
    tokenAddress: 'TOKEN_XLM',
    cryptoAmount: 250,
    cryptoAmountUnits: '250',
    assetCode: 'XLM',
    onChainSwapId: String(nextSwapId++),
  });

  it('keeps swap claim-pending when fiat succeeds but chain claim is not configured', async () => {
    process.env.FIAT_MODE = 'mock';
    process.env.SWAP_PRICE_MODE = 'static';
    delete process.env.STELLAR_CONTRACT_ID;
    delete process.env.STELLAR_RELAYER_SECRET;
    const email = `swap_ok_${Date.now()}@test.com`;
    const user = await createUser(email);

    const res = await request(app).post('/swap/execute').send(body(email));

    expect(res.status).toBe(200);
    expect(res.body.swap.status).toBe('FIAT_SENT_CLAIM_PENDING');
    const row = await prisma.swap.findFirst({ where: { userId: user.id } });
    expect(row?.status).toBe('FIAT_SENT_CLAIM_PENDING');
    expect(row?.assetCode).toBe('XLM');
    expect(row?.tokenLabel).toBe('XLM');
    expect(row?.cryptoAmountUnits).toBe('250');
    expect(row?.nairaAmountKobo).toMatch(/^\d+$/);
    expect(row?.quoteRateNaira).toBeGreaterThan(0);
  });

  it('does not mark a fiat failure as refunded before on-chain refund', async () => {
    process.env.FIAT_MODE = 'live';
    process.env.SWAP_PRICE_MODE = 'static';
    delete process.env.PAYSTACK_SECRET_KEY;
    delete process.env.LENCO_API_KEY;
    delete process.env.LENCO_ACCOUNT_ID;
    // This test uses a synthetic swap id that was never actually created on-chain via a real
    // confidential_swap call, so the on-chain payout verification must be disabled here too —
    // this test is about fiat-provider failure, not chain verification.
    delete process.env.STELLAR_CONTRACT_ID;
    delete process.env.STELLAR_RELAYER_SECRET;
    const email = `swap_fail_${Date.now()}@test.com`;
    const user = await createUser(email);

    const res = await request(app).post('/swap/execute').send(body(email));

    expect(res.status).toBe(502);
    const row = await prisma.swap.findFirst({ where: { userId: user.id } });
    expect(row?.status).toBe('FIAT_FAILED_REFUND_PENDING');
  });

  it('refuses to pay out the same on-chain swap id twice', async () => {
    process.env.FIAT_MODE = 'mock';
    process.env.SWAP_PRICE_MODE = 'static';
    delete process.env.STELLAR_CONTRACT_ID;
    delete process.env.STELLAR_RELAYER_SECRET;
    const email = `swap_replay_${Date.now()}@test.com`;
    await createUser(email);
    const reqBody = body(email);

    const first = await request(app).post('/swap/execute').send(reqBody);
    expect(first.status).toBe(200);

    const second = await request(app).post('/swap/execute').send(reqBody);
    expect(second.status).toBe(409);

    const rows = await prisma.swap.findMany({ where: { swapId: reqBody.onChainSwapId } });
    expect(rows).toHaveLength(1);
  });

  it('rejects a swap that is no longer pending on-chain', async () => {
    process.env.FIAT_MODE = 'mock';
    process.env.SWAP_PRICE_MODE = 'static';
    process.env.STELLAR_RELAYER_SECRET = 'S'.repeat(56); // never used: getPayout short-circuits first
    getPayoutMock.mockResolvedValueOnce({
      blindedBankHash: new Uint8Array(32),
      amount: 5_000_000n,
      refundCommitment: new Uint8Array(32),
      created: 0n,
      status: 'Completed',
    });
    const email = `swap_notpending_${Date.now()}@test.com`;
    await createUser(email);

    const res = await request(app).post('/swap/execute').send(body(email));

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/completed/i);
    expect(getPayoutMock).toHaveBeenCalledTimes(1);
  });

  it('prices off the on-chain proven amount, not the client-claimed amount', async () => {
    process.env.FIAT_MODE = 'mock';
    process.env.SWAP_PRICE_MODE = 'static';
    process.env.STELLAR_RELAYER_SECRET = 'S'.repeat(56);
    // On-chain truth says 1 XLM (1e7 stroops) was actually proven/escrowed.
    getPayoutMock.mockResolvedValueOnce({
      blindedBankHash: new Uint8Array(32),
      amount: 10_000_000n,
      refundCommitment: new Uint8Array(32),
      created: 0n,
      status: 'Pending',
    });
    const email = `swap_tamper_${Date.now()}@test.com`;
    const user = await createUser(email);
    // Client claims a wildly larger amount than what's on-chain.
    const reqBody = { ...body(email), cryptoAmount: 999999, cryptoAmountUnits: '9999990000000' };

    const res = await request(app).post('/swap/execute').send(reqBody);

    expect(res.status).toBe(200);
    const row = await prisma.swap.findFirst({ where: { userId: user.id } });
    expect(row?.cryptoAmountUnits).toBe('10000000'); // on-chain amount, not the client's 9999990000000
    expect(row?.cryptoAmount).toBeCloseTo(1, 5);
  });

  it('quotes USDC with explicit asset metadata', async () => {
    process.env.SWAP_PRICE_MODE = 'static';

    const res = await request(app).post('/swap/quote').send({
      tokenAddress: 'TOKEN_USDC',
      cryptoAmount: 10,
      assetCode: 'USDC',
    });

    expect(res.status).toBe(200);
    expect(res.body.assetCode).toBe('USDC');
    expect(res.body.tokenLabel).toBe('USDC');
    expect(res.body.nairaAmount).toBeGreaterThan(0);
    expect(res.body.source).toBe('fallback');
  });
});
