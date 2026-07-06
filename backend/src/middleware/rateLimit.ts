import rateLimit from 'express-rate-limit';

// Disabled under vitest (NODE_ENV=test is set automatically by Vitest) so the test suite's
// repeated calls to the same route don't trip these limits.
const skip = () => process.env.NODE_ENV === 'test';

/** Baseline limiter applied to every request — defense in depth against blunt abuse. */
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  skip,
});

/** PIN-guessing endpoints (verify-pin, reissue-salt). Per-user lockout in kyc.ts does the
 * real work; this just caps how fast a single IP can throw guesses at the DB. */
export const pinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip,
});

/** /swap/resolve-account is an unauthenticated bank-name lookup (name enquiry) — without a
 * limit it's an open oracle for resolving any account number to its owner's real name. */
export const accountLookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip,
});

/** /auth/web3auth verifies a client-supplied idToken against a remote JWKS on every call — cap
 * how fast a single IP can throw tokens at it (garbage-token DoS / email-enumeration timing). */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip,
});

/** /kyc/submit-bvn calls out to a paid third-party BVN verification API — without a limit this
 * is an open door to run up the provider bill or brute-force BVNs against it. */
export const bvnLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip,
});

/** /kyc/link-wallet grants a real faucet-funded note to every brand-new account, but it also
 * serves returning-user logins — so this stays generous (a shared office/campus IP can see many
 * logins/hour) while still bounding how fast scripted new-account creation can drain the faucet
 * pool wallet. */
export const faucetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip,
});
