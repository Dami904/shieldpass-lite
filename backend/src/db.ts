import 'dotenv/config';
import { PrismaClient } from './generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Single shared Prisma client for the whole backend.
 * Importing this everywhere avoids opening a separate connection pool per route file.
 *
 * Prisma 7 requires a driver adapter — we use node-postgres (`pg`) over a direct TCP
 * connection to Neon. The connection string must be the DIRECT (non-pooled) Neon URL with
 * `sslmode=require` and WITHOUT `channel_binding` (see NEON_CONNECTION_STRING in .env / Render).
 */
const adapter = new PrismaPg({ connectionString: process.env.NEON_CONNECTION_STRING });

export const prisma = new PrismaClient({ adapter });
