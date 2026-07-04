import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

// Prisma 7 moved the Migrate/CLI connection URL out of schema.prisma into this file.
// .env is not auto-loaded by the CLI anymore, hence the explicit `dotenv/config` import.
// Use the DIRECT (non-pooled) Neon URL with `sslmode=require` and no `channel_binding`.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('NEON_CONNECTION_STRING'),
  },
});
