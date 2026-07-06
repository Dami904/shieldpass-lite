import 'dotenv/config';
import { app } from './app';
import { logger } from './logger';

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  logger.info(`Backend server running on http://localhost:${PORT}`);
});

// ── Catch unhandled errors so they always appear in Render logs ──
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, '[unhandledRejection]');
});
process.on('uncaughtException', (err) => {
  logger.error({ err }, '[uncaughtException]');
});
