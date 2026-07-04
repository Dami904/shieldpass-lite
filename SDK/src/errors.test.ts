import { describe, it, expect } from 'vitest';
import { humanizeError } from './errors';

describe('humanizeError', () => {
  it('maps an on-chain insufficient-balance trap to a funds message', () => {
    // This is the real shape of the create_offer failure: a token transfer reverts
    // because the wallet holds nothing, and the contract panics → WasmVm trap.
    const raw =
      '[StellarContractClient] Simulation failed: {"error":"HostError: Error(WasmVm, InvalidAction)\\n' +
      'VM call trapped: UnreachableCodeReached, create_offer"}';
    const { title, detail } = humanizeError(raw);
    expect(title).toMatch(/balance|funds/i);
    expect(detail).toContain('UnreachableCodeReached'); // raw kept for debugging
  });

  it('maps a network failure to a connection message', () => {
    const { title } = humanizeError(new TypeError('Failed to fetch'));
    expect(title).toMatch(/network|connection/i);
  });

  it('maps a dismissed passkey prompt to a retry message', () => {
    const err = new Error('The operation was aborted');
    err.name = 'NotAllowedError';
    const { title } = humanizeError(err);
    expect(title).toMatch(/passkey|device|approve/i);
  });

  it('maps a proof-generation failure to a proof message', () => {
    const { title } = humanizeError(new Error('Proof generation failed.'));
    expect(title).toMatch(/proof/i);
  });

  it('maps an already-used nullifier to a re-verify message', () => {
    const { title } = humanizeError(new Error('nullifier already used'));
    expect(title).toMatch(/already|re-?verify|used/i);
  });

  it('falls back to a generic message for unknown errors, keeping the detail', () => {
    const { title, detail } = humanizeError(new Error('something weird 0xdeadbeef'));
    expect(title).toMatch(/something went wrong|couldn'?t|try again/i);
    expect(detail).toContain('0xdeadbeef');
  });

  it('accepts a plain string and a null/undefined input without throwing', () => {
    expect(humanizeError('boom').detail).toContain('boom');
    expect(humanizeError(null).title).toBeTruthy();
    expect(humanizeError(undefined).title).toBeTruthy();
  });

  it('truncates very long technical detail', () => {
    const long = 'x'.repeat(5000);
    expect(humanizeError(long).detail.length).toBeLessThanOrEqual(600);
  });
});
