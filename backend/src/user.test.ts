import { describe, it, expect, afterEach } from 'vitest';
import { prisma } from './db';

const ids: string[] = [];

function genWallet() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let w = 'C';
  for(let i=0; i<55; i++) w += chars[Math.floor(Math.random() * chars.length)];
  return w;
}

afterEach(async () => {
  if (ids.length) await prisma.user.deleteMany({ where: { id: { in: ids } } });
  ids.length = 0;
});

describe('User smart-wallet fields', () => {
  it('stores a smart wallet address + passkey key id', async () => {
    const w = genWallet();
    const u = await prisma.user.create({
      data: {
        email: `u_${Date.now()}@test.com`,
        smartWalletAddress: w,
        passkeyKeyId: 'key_abc123',
      },
    });
    ids.push(u.id);
    expect(u.smartWalletAddress).toBe(w);
    expect(u.passkeyKeyId).toBe('key_abc123');
  });

  it('defaults the new fields to null when omitted', async () => {
    const u = await prisma.user.create({ data: { email: `u_${Date.now()}_b@test.com` } });
    ids.push(u.id);
    expect(u.smartWalletAddress).toBeNull();
    expect(u.passkeyKeyId).toBeNull();
    expect(u.walletAddress).toBeNull();
  });
});
