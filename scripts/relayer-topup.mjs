// Guaranteed relayer top-up (testnet), independent of the relayer's current balance.
//
// Friendbot only reliably funds NEW accounts (~10,000 XLM); it won't repeatedly top up an
// existing one. So we: (1) generate a fresh ephemeral keypair, (2) friendbot-fund it, then
// (3) account-merge the ephemeral into the relayer — moving its entire ~10,000 XLM across
// and deleting the throwaway. This always adds funds, no matter how much the relayer holds.
//
// Needs only the PUBLIC relayer address (RELAYER env). No relayer secret is used.
import { Keypair, Horizon, TransactionBuilder, Operation, BASE_FEE, Networks } from '@stellar/stellar-sdk';

const RELAYER = process.env.RELAYER;
if (!RELAYER) { console.error('RELAYER env not set'); process.exit(1); }

const HORIZON = 'https://horizon-testnet.stellar.org';
const server = new Horizon.Server(HORIZON);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function balanceOf(addr) {
  try {
    const a = await server.loadAccount(addr);
    const n = a.balances.find((b) => b.asset_type === 'native');
    return n ? n.balance : '0';
  } catch { return 'unknown'; }
}

const before = await balanceOf(RELAYER);
console.log(`Relayer ${RELAYER} balance before: ${before} XLM`);

// 1. fresh ephemeral account
const eph = Keypair.random();
console.log(`Ephemeral funding account: ${eph.publicKey()}`);

// 2. friendbot the NEW account (reliable: creates it with ~10,000 XLM).
// Retry on transient network errors / non-2xx — runners occasionally blip.
async function friendbotFund(addr) {
  for (let i = 1; i <= 5; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 30000);
      const res = await fetch(`https://friendbot.stellar.org?addr=${addr}`, { signal: ctrl.signal });
      clearTimeout(t);
      if (res.ok) return true;
      console.warn(`friendbot attempt ${i}: HTTP ${res.status}`);
    } catch (e) {
      console.warn(`friendbot attempt ${i}: ${e?.message || e}`);
    }
    await sleep(3000 * i);
  }
  return false;
}
if (!(await friendbotFund(eph.publicKey()))) {
  console.error('friendbot failed to fund ephemeral account after retries — aborting.');
  process.exit(1);
}
console.log('Ephemeral account funded by friendbot.');

// 3. wait until it's queryable, then merge it into the relayer
let acct;
for (let i = 0; i < 12; i++) {
  try { acct = await server.loadAccount(eph.publicKey()); break; }
  catch { await sleep(2000); }
}
if (!acct) { console.error('Ephemeral account not visible on Horizon yet — aborting.'); process.exit(1); }

const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
  .addOperation(Operation.accountMerge({ destination: RELAYER }))
  .setTimeout(120)
  .build();
tx.sign(eph);

try {
  const res = await server.submitTransaction(tx);
  console.log(`Account-merge submitted: ${res.hash}`);
} catch (e) {
  const codes = e?.response?.data?.extras?.result_codes;
  console.error('Account-merge failed:', codes ? JSON.stringify(codes) : (e?.message || e));
  process.exit(1);
}

const after = await balanceOf(RELAYER);
console.log(`Relayer balance after: ${after} XLM (was ${before}).`);
console.log('Top-up complete.');
