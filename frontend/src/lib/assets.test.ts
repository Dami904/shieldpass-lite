import { describe, it, expect } from 'vitest';
import { parseUnits, formatUnits, assetByCode, assetLabel, SUPPORTED_ASSETS } from './assets';

describe('parseUnits', () => {
  it('parses a whole number at the given decimals', () => {
    expect(parseUnits('100', 7)).toBe(1_000_000_000n);
  });

  it('parses a fractional amount, padding to the given decimals', () => {
    expect(parseUnits('1.5', 7)).toBe(15_000_000n);
  });

  it('parses an amount using the full decimal precision', () => {
    expect(parseUnits('0.0000001', 7)).toBe(1n);
  });

  it('parses "0" as zero', () => {
    expect(parseUnits('0', 7)).toBe(0n);
  });

  it('trims surrounding whitespace', () => {
    expect(parseUnits('  42  ', 7)).toBe(420_000_000n);
  });

  it('rejects more fractional digits than the asset supports', () => {
    expect(() => parseUnits('1.00000001', 7)).toThrow('Use at most 7 decimal places.');
  });

  it('rejects non-numeric input', () => {
    expect(() => parseUnits('abc', 7)).toThrow('Enter a valid amount.');
  });

  it('rejects negative numbers', () => {
    expect(() => parseUnits('-5', 7)).toThrow('Enter a valid amount.');
  });

  it('rejects empty input', () => {
    expect(() => parseUnits('', 7)).toThrow('Enter a valid amount.');
  });

  it('rejects a bare decimal point with no digits', () => {
    expect(() => parseUnits('.', 7)).toThrow('Enter a valid amount.');
  });

  it('rejects multiple decimal points', () => {
    expect(() => parseUnits('1.2.3', 7)).toThrow('Enter a valid amount.');
  });
});

describe('formatUnits', () => {
  it('formats a whole-unit amount with no fraction', () => {
    expect(formatUnits(1_000_000_000n, 7)).toBe('100');
  });

  it('formats a fractional amount, stripping trailing zeros', () => {
    expect(formatUnits(15_000_000n, 7)).toBe('1.5');
  });

  it('formats zero as "0"', () => {
    expect(formatUnits(0n, 7)).toBe('0');
  });

  it('formats a negative amount with a leading minus', () => {
    expect(formatUnits(-15_000_000n, 7)).toBe('-1.5');
  });

  it('truncates the fraction to maxFractionDigits', () => {
    expect(formatUnits(1_234_567n, 7, 2)).toBe('0.12');
  });

  it('adds thousands separators to the whole part', () => {
    expect(formatUnits(12_345_000_000_000n, 7)).toBe('1,234,500');
  });

  it('accepts a string of raw units as well as a bigint', () => {
    expect(formatUnits('1000000000', 7)).toBe('100');
  });

  it('round-trips through parseUnits for a representative amount', () => {
    const units = parseUnits('123.456', 7);
    expect(formatUnits(units, 7)).toBe('123.456');
  });
});

describe('assetByCode', () => {
  it('resolves a known code case-insensitively', () => {
    expect(assetByCode('xlm')?.code).toBe('XLM');
    expect(assetByCode('USDC')?.code).toBe('USDC');
  });

  it('returns undefined for an unknown code', () => {
    expect(assetByCode('DOGE')).toBeUndefined();
  });

  it('returns undefined for null/undefined/empty input', () => {
    expect(assetByCode(null)).toBeUndefined();
    expect(assetByCode(undefined)).toBeUndefined();
    expect(assetByCode('')).toBeUndefined();
  });
});

describe('assetLabel', () => {
  it('returns the canonical code for a known asset', () => {
    expect(assetLabel('xlm')).toBe('XLM');
  });

  it('uppercases an unknown code rather than throwing', () => {
    expect(assetLabel('doge')).toBe('DOGE');
  });

  it('falls back to "TOKEN" for empty input', () => {
    expect(assetLabel('')).toBe('TOKEN');
    expect(assetLabel(null)).toBe('TOKEN');
  });
});

describe('SUPPORTED_ASSETS', () => {
  it('only includes assets with both a SAC address and a pool contract id configured', () => {
    for (const asset of SUPPORTED_ASSETS) {
      expect(asset.sac).toBeTruthy();
      expect(asset.poolContractId).toBeTruthy();
    }
  });
});
