/**
 * Probe whether CHANNELS_URL/CHANNELS_API_KEY authenticate against OpenZeppelin Channels.
 *
 * We can't run a real gasless submit here (no passkey-signed XDR), so this sends a deliberately
 * junk XDR and reads the failure mode:
 *   - 401/403 (auth) error            -> key is REJECTED
 *   - 400/422 / parse / execution err -> key was ACCEPTED (request got past auth, XDR is just bad)
 *
 * Run:  cd backend && npx ts-node scripts/test-channels.ts
 */
import 'dotenv/config';
import { ChannelsClient } from '@openzeppelin/relayer-plugin-channels';

async function main() {
  const baseUrl = process.env.CHANNELS_URL;
  const apiKey = process.env.CHANNELS_API_KEY;

  if (!baseUrl || !apiKey || apiKey === 'replace_with_your_channels_testnet_key') {
    console.error('✗ CHANNELS_URL / CHANNELS_API_KEY not set in backend/.env (still the placeholder?).');
    process.exit(2);
  }
  console.log(`→ baseUrl: ${baseUrl}`);
  console.log(`→ apiKey:  ${apiKey.slice(0, 4)}…${apiKey.slice(-4)} (len ${apiKey.length})`);

  const client = new ChannelsClient({ baseUrl, apiKey });

  try {
    // Intentionally invalid XDR — we only care whether auth passes.
    await client.submitTransaction({ xdr: 'AAAAnot-a-real-xdr' });
    console.log('✓ Request authenticated (and unexpectedly accepted the junk XDR).');
  } catch (err: any) {
    const status = err?.statusCode;
    const category = err?.category;
    const detail = err?.errorDetails ? JSON.stringify(err.errorDetails) : err?.message;
    if (status === 401 || status === 403) {
      console.error(`✗ KEY REJECTED — auth failed (HTTP ${status}). ${detail}`);
      process.exit(1);
    }
    console.log(`✓ KEY ACCEPTED — auth passed; request failed later as expected.`);
    console.log(`  (category=${category} status=${status ?? 'n/a'}) ${detail}`);
  }
}

main().catch((e) => { console.error('probe crashed:', e); process.exit(3); });
