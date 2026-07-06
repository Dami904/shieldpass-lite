import { Router } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
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
const jwks = createRemoteJWKSet(new URL(WEB3AUTH_JWKS_URL));

router.post('/web3auth', authLimiter, async (req, res) => {
  const { idToken } = req.body;
  if (!idToken || typeof idToken !== 'string') return res.status(400).json({ error: 'idToken is required.' });

  try {
    const { payload } = await jwtVerify(idToken, jwks, {
      // Web3Auth's idToken audience is the app's Web3Auth client id — set this in the backend
      // env once the Web3Auth project is created, so a token minted for a different app can't
      // be replayed against this one.
      audience: process.env.WEB3AUTH_CLIENT_ID || undefined,
    });

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
