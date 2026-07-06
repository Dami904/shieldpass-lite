import pino from 'pino';

// Matches the NODE_ENV convention already used elsewhere in this codebase (e.g.
// middleware/rateLimit.ts) — pretty-print for local dev, plain JSON (the pino default) once
// deployed, so log aggregators (Render, etc.) get structured lines rather than ANSI-colored text.
const isDev = process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test';

export const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  transport: isDev
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' } }
    : undefined,
});
