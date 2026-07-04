import { describe, it, expect } from 'vitest';
import { isValidStellarAddress, isValidSorobanAddress } from './utils';

const G = 'GDSNLVSSQJI3YNKCBEU6CP2D5OWQIWX7YETVY2DIZJBRKDBIRINIET7G'; // 56-char account
const C = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'; // 56-char contract

describe('isValidStellarAddress', () => {
  it('accepts a G-address, rejects a C-address', () => {
    expect(isValidStellarAddress(G)).toBe(true);
    expect(isValidStellarAddress(C)).toBe(false);
  });
});

describe('isValidSorobanAddress', () => {
  it('accepts both G- and C-addresses', () => {
    expect(isValidSorobanAddress(G)).toBe(true);
    expect(isValidSorobanAddress(C)).toBe(true);
  });
  it('rejects malformed input', () => {
    expect(isValidSorobanAddress('GBAD')).toBe(false);
    expect(isValidSorobanAddress('')).toBe(false);
    expect(isValidSorobanAddress('XDSNLVSSQJI3YNKCBEU6CP2D5OWQIWX7YETVY2DIZJBRKDBIRINIET7G')).toBe(false);
  });
});
