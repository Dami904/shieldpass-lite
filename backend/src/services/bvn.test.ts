import { describe, it, expect } from 'vitest';
import { verifyBvn } from './bvn';

describe('verifyBvn (mock seam)', () => {
  it('passes a valid 11-digit BVN and returns a non-empty legal name', async () => {
    const r = await verifyBvn('12345678901');
    expect(r.ok).toBe(true);
    expect(typeof r.returnedName).toBe('string');
    expect(r.returnedName.length).toBeGreaterThan(0);
  });
  it('returns the SAME name for the SAME BVN (deterministic)', async () => {
    const a = await verifyBvn('22110000001');
    const b = await verifyBvn('22110000001');
    expect(a.returnedName).toBe(b.returnedName);
  });
  it('rejects a malformed BVN', async () => {
    expect((await verifyBvn('123')).ok).toBe(false);
    expect((await verifyBvn('abcdefghijk')).ok).toBe(false);
  });
});
