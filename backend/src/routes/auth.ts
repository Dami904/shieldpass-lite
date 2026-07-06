import { Router } from 'express';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { logger } from '../logger';
import { authLimiter } from '../middleware/rateLimit';

const router = Router();

// Firebase Auth (Lite's multi-provider login aggregator — Google, Facebook, X, email link, etc,
// all through one integration) issues its own signed idToken after a successful social login.
// We verify it here rather than trusting the client-supplied email directly, because email is
// the account key the rest of the backend upserts users on (kyc.ts /link-wallet) — a forged
// email would let someone claim an existing account.
//
// Firebase does NOT create or hold the wallet key for Lite: this route only turns a verified
// social login into a verified email. Everything after that (passkey creation, smart wallet
// deploy, /kyc/link-wallet) is the same non-custodial flow ShieldPass already uses.
//
// (Previously used Web3Auth for this — replaced after its Sapphire Devnet JWKS endpoint proved
// to not contain the key actually signing tokens, confirmed via cache-busted origin fetches.
// Firebase Auth is also a better architectural fit: we only ever needed identity verification,
// never Web3Auth's wallet features, which were unused by design.)
if (!getApps().length) {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  // Render/Vercel env vars can't hold real newlines — the private key is stored with literal
  // "\n" escapes and un-escaped here.
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (projectId && clientEmail && privateKey) {
    initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  } else {
    logger.warn('[auth] FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY not fully configured — /auth/session will fail.');
  }
}

router.post('/session', authLimiter, async (req, res) => {
  const { idToken } = req.body;
  if (!idToken || typeof idToken !== 'string') return res.status(400).json({ error: 'idToken is required.' });

  try {
    const decoded = await getAuth().verifyIdToken(idToken);

    const email = typeof decoded.email === 'string' ? decoded.email : undefined;
    const emailVerified = decoded.email_verified !== false; // most providers set this true; email-link login has no field at all
    if (!email || !emailVerified) {
      return res.status(401).json({ error: 'Social login did not return a verified email.' });
    }

    // uid — a stable per-user id Firebase assigns, used as googleSub-style linkage in
    // /kyc/link-wallet so the same account can be recognized across sessions.
    const providerSub = typeof decoded.uid === 'string' ? decoded.uid : undefined;

    return res.json({ email, providerSub });
  } catch (err) {
    logger.error({ err }, '[auth/session]');
    return res.status(401).json({ error: 'Invalid or expired social login token.' });
  }
});

export default router;
