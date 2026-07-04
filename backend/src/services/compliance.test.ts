import { describe, it, expect, afterEach } from 'vitest';
import { prisma } from '../db';
import { checkProof, burnNullifier } from './compliance';

const nullifiers: string[] = [];
afterEach(async () => {
  if (nullifiers.length) await prisma.nullifier.deleteMany({ where: { value: { in: nullifiers } } });
  nullifiers.length = 0;
});

describe('compliance service', () => {
  it('burnNullifier records a nullifier', async () => {
    const n = `null_${Date.now()}`;
    nullifiers.push(n);
    await burnNullifier(n, 'GWALLET', 'create_offer');
    const row = await prisma.nullifier.findUnique({ where: { value: n } });
    expect(row).not.toBeNull();
  });

  it('checkProof returns 409 for an already-spent nullifier (before any proof work)', async () => {
    const n = `null_spent_${Date.now()}`;
    nullifiers.push(n);
    await burnNullifier(n, 'GWALLET', 'create_offer');
    const result = await checkProof({ proof: '0x00', publicInputs: ['0'], nullifier: n });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
  });
});
