// One-off admin tool: raise the OpenZeppelin Channels per-API-key fee limit.
//
// Wallet deploys cost ~1.05B stroops (~105 XLM) of Soroban resource fee, which exceeds the
// relayer's default 1,000,000,000-stroop cap (FEE_LIMIT_EXCEEDED). Run this once to raise it.
//
// Requires in backend/.env:  CHANNELS_URL, CHANNELS_API_KEY, CHANNELS_ADMIN_SECRET
// Usage:  node scripts/set-channels-fee-limit.mjs [limitStroops]   (default 5_000_000_000 = 500 XLM)
import 'dotenv/config';
import { ChannelsClient } from '@openzeppelin/relayer-plugin-channels';

const limit = Number(process.argv[2] ?? 5_000_000_000);
const { CHANNELS_URL, CHANNELS_API_KEY, CHANNELS_ADMIN_SECRET } = process.env;

if (!CHANNELS_URL || !CHANNELS_API_KEY || !CHANNELS_ADMIN_SECRET) {
  console.error('Missing env. Set CHANNELS_URL, CHANNELS_API_KEY and CHANNELS_ADMIN_SECRET in backend/.env');
  process.exit(1);
}

const client = new ChannelsClient({
  baseUrl: CHANNELS_URL,
  apiKey: CHANNELS_API_KEY,
  adminSecret: CHANNELS_ADMIN_SECRET,
});

const safe = (p) => p.then((v) => JSON.stringify(v)).catch((e) => `ERROR: ${e.message}`);

console.log('current fee limit :', await safe(client.getFeeLimit(CHANNELS_API_KEY)));
console.log(`setting fee limit -> ${limit} stroops (${limit / 1e7} XLM)`);
console.log('set result        :', await safe(client.setFeeLimit(CHANNELS_API_KEY, limit)));
console.log('new fee limit     :', await safe(client.getFeeLimit(CHANNELS_API_KEY)));
