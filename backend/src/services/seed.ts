import { Networks, Keypair } from '@stellar/stellar-sdk';
import { StellarContractClient } from '@shieldpass/sdk';

/** One token to seed and the target amount (raw i128 stroops) a new wallet should end up holding. */
export interface SeedConfig {
  tokenId: string;
  amount: bigint;
}

export interface SeedDeps {
  configs: SeedConfig[];
  /** Current SAC balance of `tokenId` held by the wallet. */
  getBalance: (tokenId: string, address: string) => Promise<bigint>;
  /** Transfer `amount` of `tokenId` into the wallet from the relayer. Returns a tx hash. */
  fund: (tokenId: string, to: string, amount: bigint) => Promise<string>;
}

export interface SeedResult {
  tokenId: string;
  status: 'funded' | 'skipped' | 'failed';
  hash?: string;
  error?: string;
}

/**
 * Best-effort seeding of a freshly-deployed smart wallet. For each configured token, tops the
 * wallet up to the target amount if it's short. Never throws — onboarding must not fail because a
 * seed transfer did (e.g. the relayer is out of that asset); failures are reported per-token.
 */
export async function seedWallet(address: string, deps: SeedDeps): Promise<SeedResult[]> {
  const results: SeedResult[] = [];
  for (const { tokenId, amount } of deps.configs) {
    try {
      const balance = await deps.getBalance(tokenId, address);
      if (balance >= amount) {
        results.push({ tokenId, status: 'skipped' });
        continue;
      }
      const hash = await deps.fund(tokenId, address, amount);
      results.push({ tokenId, status: 'funded', hash });
    } catch (err) {
      results.push({ tokenId, status: 'failed', error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}

/**
 * Parses SEED_TOKENS env: comma-separated `contractId:amount` pairs, e.g.
 *   SEED_TOKENS="CDLZ...:1000000000,CBIE...:2000000000"
 */
export function parseSeedTokens(raw: string | undefined): SeedConfig[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const [tokenId, amount] = pair.split(':').map((s) => s.trim());
      return { tokenId, amount: BigInt(amount) };
    });
}

/**
 * Production entry point: builds SeedDeps from env + the SDK + the relayer keypair and seeds the
 * wallet. Returns [] (a no-op) when seeding isn't configured. Safe to call on every wallet link.
 */
export async function seedWalletFromEnv(address: string): Promise<SeedResult[]> {
  const configs = parseSeedTokens(process.env.SEED_TOKENS);
  const relayerSecret = process.env.STELLAR_RELAYER_SECRET;
  if (configs.length === 0 || !relayerSecret) return [];

  const rpcUrl = process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org';
  const network = process.env.STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET;
  const relayer = Keypair.fromSecret(relayerSecret);
  // getTokenBalance/fundWallet take the token id explicitly and ignore the client's contractId,
  // so seeding doesn't depend on the escrow being configured — any valid address satisfies the ctor.
  const client = new StellarContractClient(rpcUrl, network, configs[0].tokenId);

  return seedWallet(address, {
    configs,
    getBalance: (tokenId, addr) => client.getTokenBalance(tokenId, addr),
    fund: (tokenId, to, amount) => client.fundWallet(tokenId, to, amount, relayer),
  });
}
