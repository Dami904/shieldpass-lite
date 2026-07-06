import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import kycRoutes from './routes/kyc';
import authRoutes from './routes/auth';
import relayerRoutes from './routes/relayer';
import swapRoutes from './routes/swap';
import treeRoutes from './routes/tree';
import notesRoutes from './routes/notes';
import notificationsRoutes from './routes/notifications';

import walletRoutes from './routes/wallet';
import { globalLimiter } from './middleware/rateLimit';
import { logger } from './logger';

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
  logger.warn('[app] CORS_ORIGIN is not set — allowing all origins. Set it in production.');
}
app.use(cors(allowedOrigins.length > 0 ? { origin: allowedOrigins } : undefined));
// Capture the raw request body so Lenco webhooks can verify HMAC signatures.
app.use(express.json({ verify: (req, _res, buf) => { (req as any).rawBody = buf.toString('utf8'); } }));

// ── Request logger: must be registered BEFORE routes so it fires for every request ──
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    logger.info({ method: req.method, path: req.path, status: res.statusCode, ms }, 'request');
  });
  next();
});

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'shieldpass-backend' }));

app.use('/kyc', kycRoutes);
app.use('/auth', authRoutes);
app.use('/swap', swapRoutes);
app.use('/tree', treeRoutes);
app.use('/notes', notesRoutes);
app.use('/notifications', notificationsRoutes);

app.use('/verify', relayerRoutes);
app.use('/wallet', walletRoutes);

// ── Catch-all error handler: must be registered LAST. Express only routes here for errors
// thrown synchronously or passed to next(err) — most handlers in this codebase already catch
// and respond themselves, but this is the backstop so a missed one still gets logged (and shows
// up on Render) instead of silently hanging or defaulting to Express's own unlogged response.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err, method: req.method, path: req.path }, '[app] unhandled route error');
  if (res.headersSent) return;
  res.status(500).json({ error: 'Internal server error.' });
});
