import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../db';

const emails: string[] = [];

function genWallet() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let w = 'C';
  for(let i=0; i<55; i++) w += chars[Math.floor(Math.random() * chars.length)];
  return w;
}

afterEach(async () => {
  for (const email of emails) {
    const u = await prisma.user.findUnique({ where: { email } });
    if (u) {
      await prisma.complianceAttestation.deleteMany({ where: { userId: u.id } });
      await prisma.user.delete({ where: { id: u.id } });
    }
  }
  emails.length = 0;
});

describe('POST /kyc/submit-bvn (email-keyed)', () => {
  it('upgrades a user by email, returns the BVN legal name + secret salt — but never stores it (zero-storage)', async () => {
    const email = `bvn_${Date.now()}@test.com`;
    emails.push(email);
    await request(app).post('/kyc/link-wallet').send({
      email, pin: '1234', smartWalletAddress: genWallet(), passkeyKeyId: 'key_1'
    });
    const res = await request(app).post('/kyc/submit-bvn').send({ email, phone: '08000000000', bvn: '12345678901' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.returnedName).toBe('string');
    expect(res.body.returnedName.length).toBeGreaterThan(0);
    expect(typeof res.body.secretSalt).toBe('string');
    expect(typeof res.body.merkleRoot).toBe('string');
    // The legal name and phone are handed back for the frontend to cache client-side, but the
    // User row itself has no columns to persist them in at all — zero-storage by construction.
    const u = await prisma.user.findUnique({ where: { email } });
    expect(u && 'name' in u).toBe(false);
    expect(u && 'phone' in u).toBe(false);
  });

  it('rejects a malformed BVN with 400', async () => {
    const email = `x_${Date.now()}@test.com`;
    emails.push(email);
    await request(app).post('/kyc/link-wallet').send({
      email, pin: '1234', smartWalletAddress: genWallet(), passkeyKeyId: 'key_1'
    });
    const res = await request(app).post('/kyc/submit-bvn').send({ email, bvn: '123' });
    expect(res.status).toBe(400);
  });

  it('is idempotent on the same email (upsert, no duplicate)', async () => {
    const email = `dup_${Date.now()}@test.com`;
    emails.push(email);
    await request(app).post('/kyc/link-wallet').send({
      email, pin: '1234', smartWalletAddress: genWallet(), passkeyKeyId: 'key_1'
    });
    await request(app).post('/kyc/submit-bvn').send({ email, bvn: '12345678901' });
    const res2 = await request(app).post('/kyc/submit-bvn').send({ email, bvn: '12345678901' });
    expect(res2.status).toBe(200);
    expect(await prisma.user.count({ where: { email } })).toBe(1);
  });
});

describe('POST /kyc/verify-pin', () => {
  async function onboard(email: string, pin: string) {
    emails.push(email);
    await request(app).post('/kyc/link-wallet').send({
      email, pin, smartWalletAddress: genWallet(), passkeyKeyId: 'key_1'
    });
  }
  it('accepts the correct pin', async () => {
    const email = `vp_${Date.now()}@test.com`;
    await onboard(email, '4321');
    const res = await request(app).post('/kyc/verify-pin').send({ email, pin: '4321' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
  it('rejects a wrong pin', async () => {
    const email = `vpw_${Date.now()}@test.com`;
    await onboard(email, '4321');
    const res = await request(app).post('/kyc/verify-pin').send({ email, pin: '0000' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
  });
  it('404s for an unknown email', async () => {
    const res = await request(app).post('/kyc/verify-pin').send({ email: `none_${Date.now()}@test.com`, pin: '1234' });
    expect(res.status).toBe(404);
  });
});

describe('POST /kyc/link-wallet', () => {
  it('links a smart wallet + passkey key id to the user', async () => {
    const email = `link_${Date.now()}@test.com`;
    emails.push(email);
    const w = genWallet();
    const res = await request(app).post('/kyc/link-wallet').send({
      email, pin: '1234', smartWalletAddress: w, passkeyKeyId: 'key_1',
    });
    expect(res.status).toBe(200);
    const u = await prisma.user.findUnique({ where: { email } });
    expect(u?.smartWalletAddress).toBe(w);
    expect(u?.passkeyKeyId).toBe('key_1');
  });

  it('rejects a bad smart wallet address with 400', async () => {
    const email = `linkbad_${Date.now()}@test.com`;
    const res = await request(app).post('/kyc/link-wallet').send({ email, pin: '1234', smartWalletAddress: 'NOTANADDRESS' });
    expect(res.status).toBe(400);
  });
});

describe('POST /kyc/reissue-salt (login on a new device)', () => {
  async function onboard(email: string) {
    emails.push(email);
    return request(app).post('/kyc/link-wallet').send({
      email, pin: '1234', smartWalletAddress: genWallet(), passkeyKeyId: 'key_1'
    });
  }

  it('mints a fresh salt + new merkleRoot for a verified user with the correct PIN', async () => {
    const email = `reissue_${Date.now()}@test.com`;
    const first = await onboard(email);
    const res = await request(app).post('/kyc/reissue-salt').send({ email, pin: '1234' });
    expect(res.status).toBe(200);
    expect(typeof res.body.secretSalt).toBe('string');
    expect(typeof res.body.merkleRoot).toBe('string');
    expect(res.body.secretSalt).not.toBe(first.body.secretSalt); // a NEW salt
  });

  it('rejects a wrong PIN with 401', async () => {
    const email = `reissuebad_${Date.now()}@test.com`;
    await onboard(email);
    const res = await request(app).post('/kyc/reissue-salt').send({ email, pin: '9999' });
    expect(res.status).toBe(401);
  });
});

describe('GET /kyc/account (wallet → account lookup for login)', () => {
  it('returns the account linked to a smart wallet', async () => {
    const email = `acct_${Date.now()}@test.com`;
    emails.push(email);
    const wallet = genWallet();
    await request(app).post('/kyc/link-wallet').send({ email, pin: '1234', smartWalletAddress: wallet, passkeyKeyId: 'key_login' });
    const res = await request(app).get(`/kyc/account?wallet=${wallet}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe(email);
  });

  it('404s for an unknown wallet', async () => {
    const res = await request(app).get('/kyc/account?wallet=CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSX');
    expect(res.status).toBe(404);
  });
});
