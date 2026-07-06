import { Router } from 'express';
import { importJWK, decodeProtectedHeader, jwtVerify, type JWTPayload, type JWK } from 'jose';
import { logger } from '../logger';
import { authLimiter } from '../middleware/rateLimit';

const router = Router();

// Web3Auth (Lite's multi-provider login aggregator — Google, Facebook, Discord, X, email OTP,
// etc, all through one integration) issues its own signed idToken after a successful social
// login. We verify it here rather than trusting the client-supplied email directly, because
// email is the account key the rest of the backend upserts users on (kyc.ts /link-wallet) — a
// forged email would let someone claim an existing account.
//
// Web3Auth does NOT create or hold the wallet key for Lite: this route only turns a verified
// social login into a verified email. Everything after that (passkey creation, smart wallet
// deploy, /kyc/link-wallet) is the same non-custodial flow ShieldPass already uses.
const WEB3AUTH_JWKS_URL = process.env.WEB3AUTH_JWKS_URL || 'https://api-auth.web3auth.io/jwks';

// We deliberately don't use jose's createRemoteJWKSet: its automatic kid-based key selection
// proved unreliable against Web3Auth's JWKS in practice (confirmed the hard way on a previous
// project) — a token's `kid` sometimes doesn't cleanly match by jose's stricter alg/kty
// filtering even though a key that verifies the signature IS present in the set. Instead, fetch
// the JWKS ourselves and try every key until one verifies, trying the kid-matched key first as
// a fast path.
const JWKS_TTL_MS = 10 * 60 * 1000;
let jwksCache: { keys: JWK[]; fetchedAt: number } = { keys: [], fetchedAt: 0 };

async function getJwks(forceRefresh = false): Promise<JWK[]> {
  const fresh = Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS;
  if (jwksCache.keys.length && fresh && !forceRefresh) return jwksCache.keys;

  const res = await fetch(WEB3AUTH_JWKS_URL);
  if (!res.ok) throw new Error(`Failed to fetch Web3Auth JWKS: ${res.status}`);
  const data = await res.json();
  jwksCache = { keys: Array.isArray(data.keys) ? data.keys : [], fetchedAt: Date.now() };
  return jwksCache.keys;
}

async function verifyWeb3AuthToken(idToken: string): Promise<JWTPayload> {
  const header = decodeProtectedHeader(idToken);
  let keys = await getJwks();

  // kid-matched key first (fast path), then every other key as a fallback.
  const order = (candidates: JWK[]) => {
    const matched = candidates.find((k) => k.kid === header.kid);
    return matched ? [matched, ...candidates.filter((k) => k !== matched)] : candidates;
  };

  let lastErr: unknown;
  for (const forceRefresh of [false, true]) {
    if (forceRefresh) keys = await getJwks(true); // kid unknown in cache — refetch once, keys may have rotated
    for (const jwk of order(keys)) {
      try {
        const key = await importJWK(jwk, 'ES256');
        const { payload } = await jwtVerify(idToken, key, {
          algorithms: ['ES256'],
          // Web3Auth's idToken audience is the app's Web3Auth client id — set this in the backend
          // env once the Web3Auth project is created, so a token minted for a different app can't
          // be replayed against this one.
          audience: process.env.WEB3AUTH_CLIENT_ID || undefined,
        });
        return payload;
      } catch (err) {
        lastErr = err; // try the next key
      }
    }
    if (keys.some((k) => k.kid === header.kid)) break; // kid was present but every key failed — refetching won't help
  }
  throw lastErr ?? new Error('No verification keys available.');
}

router.post('/web3auth', authLimiter, async (req, res) => {
  const { idToken } = req.body;
  if (!idToken || typeof idToken !== 'string') return res.status(400).json({ error: 'idToken is required.' });

  try {
    const payload = await verifyWeb3AuthToken(idToken);

    const email = typeof payload.email === 'string' ? payload.email : undefined;
    const emailVerified = payload.email_verified !== false; // most providers set this true; email/passwordless login has no field at all
    if (!email || !emailVerified) {
      return res.status(401).json({ error: 'Social login did not return a verified email.' });
    }

    // sub — a stable per-app-per-user id Web3Auth assigns (verifierId), used as googleSub-style
    // linkage in /kyc/link-wallet so the same account can be recognized across sessions.
    const providerSub = typeof payload.sub === 'string' ? payload.sub : undefined;

    return res.json({ email, providerSub });
  } catch (err) {
    logger.error({ err }, '[auth/web3auth]');
    return res.status(401).json({ error: 'Invalid or expired social login token.' });
  }
});

export default router;
