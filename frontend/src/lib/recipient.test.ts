import { describe, it, expect } from 'vitest';
import { isAddr, isEmail, isShp, isShieldPassUser, recipientFromScan } from './recipient';

// A syntactically valid-looking Stellar G-address (56 chars, starts with G, base32 alphabet).
const SAMPLE_G_ADDRESS = 'G' + 'A'.repeat(55);
const SAMPLE_C_ADDRESS = 'C' + 'B'.repeat(55);

describe('isAddr', () => {
  it('accepts a 56-char G-address', () => {
    expect(isAddr(SAMPLE_G_ADDRESS)).toBe(true);
  });

  it('accepts a 56-char C-address (contract)', () => {
    expect(isAddr(SAMPLE_C_ADDRESS)).toBe(true);
  });

  it('rejects an address that is too short', () => {
    expect(isAddr(SAMPLE_G_ADDRESS.slice(0, -1))).toBe(false);
  });

  it('rejects an address with a bad prefix', () => {
    expect(isAddr('X' + 'A'.repeat(55))).toBe(false);
  });

  it('rejects an email', () => {
    expect(isAddr('user@example.com')).toBe(false);
  });

  it('rejects a shp_ address', () => {
    expect(isAddr('shp_abc123')).toBe(false);
  });
});

describe('isEmail', () => {
  it('accepts a plain email', () => {
    expect(isEmail('user@example.com')).toBe(true);
  });

  it('rejects a string with no @', () => {
    expect(isEmail('userexample.com')).toBe(false);
  });

  it('rejects a string with no domain dot', () => {
    expect(isEmail('user@example')).toBe(false);
  });

  it('rejects an email containing whitespace', () => {
    expect(isEmail('user @example.com')).toBe(false);
  });
});

describe('isShp', () => {
  it('accepts a shp_ prefixed string', () => {
    expect(isShp('shp_abc123')).toBe(true);
  });

  it('rejects a string without the shp_ prefix', () => {
    expect(isShp('abc_shp_123')).toBe(false);
  });
});

describe('isShieldPassUser', () => {
  it('is true for an email', () => {
    expect(isShieldPassUser('user@example.com')).toBe(true);
  });

  it('is true for a shp_ address', () => {
    expect(isShieldPassUser('shp_abc123')).toBe(true);
  });

  it('is false for a raw Stellar address (this is the public/unshield path)', () => {
    expect(isShieldPassUser(SAMPLE_G_ADDRESS)).toBe(false);
  });

  it('is false for garbage input', () => {
    expect(isShieldPassUser('not a recipient')).toBe(false);
  });
});

describe('recipientFromScan', () => {
  it('extracts the "to" param from a deep-link URL', () => {
    expect(recipientFromScan('https://app.example.com/send?to=shp_abc123')).toBe('shp_abc123');
  });

  it('returns a raw shp_ address unchanged', () => {
    expect(recipientFromScan('shp_abc123')).toBe('shp_abc123');
  });

  it('returns a raw email unchanged', () => {
    expect(recipientFromScan('user@example.com')).toBe('user@example.com');
  });

  it('returns a raw Stellar address unchanged', () => {
    expect(recipientFromScan(SAMPLE_G_ADDRESS)).toBe(SAMPLE_G_ADDRESS);
  });

  it('trims surrounding whitespace from a raw value', () => {
    expect(recipientFromScan('  shp_abc123  ')).toBe('shp_abc123');
  });

  it('falls through to the raw string when the URL has no "to" param', () => {
    expect(recipientFromScan('https://app.example.com/send')).toBe('https://app.example.com/send');
  });
});
