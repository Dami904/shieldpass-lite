import { describe, it, expect } from 'vitest';
import { hashPin, verifyPin } from './pin';

describe('pin hashing', () => {
  it('verifies a correct pin against its hash', () => {
    const stored = hashPin('1234');
    expect(stored).toContain(':');
    expect(verifyPin('1234', stored)).toBe(true);
  });
  it('rejects a wrong pin', () => {
    const stored = hashPin('1234');
    expect(verifyPin('9999', stored)).toBe(false);
  });
  it('produces different hashes for the same pin (random salt)', () => {
    expect(hashPin('1234')).not.toBe(hashPin('1234'));
  });
});
