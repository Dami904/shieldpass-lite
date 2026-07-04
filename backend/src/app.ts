import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import kycRoutes from './routes/kyc';
import relayerRoutes from './routes/relayer';
import swapRoutes from './routes/swap';
import treeRoutes from './routes/tree';
import notesRoutes from './routes/notes';
import notificationsRoutes from './routes/notifications';

import walletRoutes from './routes/wallet';
import { globalLimiter } from './middleware/rateLimit';

export const app = express();

app.use(helmet());
app.use(globalLimiter);

// CORS_ORIGIN: comma-separated allowlist (e.g. "https://shieldpass.vercel.app"). Unset = allow
// any origin — fine for local dev, but set this in production (Render dashboard) so the API
// can't be driven cross-origin from an arbitrary page in a visitor's browser.
// Browsers send Origin without a trailing slash — strip one if pasted in (e.g. from a browser
// address bar) so an exact-match miss doesn't silently break CORS for the real frontend.
const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean);
if (allowedOrigins.length === 0 && process.env.NODE_ENV !== 'test') {
  console.warn('[app] CORS_ORIGIN is not set — allowing all origins. Set it in production.');
}
app.use(cors(allowedOrigins.length > 0 ? { origin: allowedOrigins } : undefined));
// Capture the raw request body so Lenco webhooks can verify HMAC signatures.
app.use(express.json({ verify: (req, _res, buf) => { (req as any).rawBody = buf.toString('utf8'); } }));

// ── Request logger: must be registered BEFORE routes so it fires for every request ──
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode} ${ms}ms`);
  });
  next();
});

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'shieldpass-backend' }));

app.use('/kyc', kycRoutes);
app.use('/swap', swapRoutes);
app.use('/tree', treeRoutes);
app.use('/notes', notesRoutes);
app.use('/notifications', notificationsRoutes);

app.use('/verify', relayerRoutes);
app.use('/wallet', walletRoutes);
