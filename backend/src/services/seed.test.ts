import { describe, it, expect } from 'vitest';
import { seedWallet, type SeedDeps } from './seed';

const WALLET = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

// Build deps with real fake functions (no mock library) — DI lets us test the orchestration
// without touching testnet. `funded` records which tokens actually got a transfer.
function makeDeps(over: Partial<SeedDeps> & { balances?: Record<string, bigint> } = {}): {
  deps: SeedDeps;
  funded: { tokenId: string; amount: bigint }[];
} {
  const balances = over.balances ?? {};
  const funded: { tokenId: string; amount: bigint }[] = [];
  const deps: SeedDeps = {
    configs: over.configs ?? [{ tokenId: 'TOKEN_A', amount: 100n }],
    getBalance: over.getBalance ?? (async (tokenId) => balances[tokenId] ?? 0n),
    fund: over.fund ?? (async (tokenId, _to, amount) => {
      funded.push({ tokenId, amount });
      return `hash_${tokenId}`;
    }),
  };
  return { deps, funded };
}

describe('seedWallet', () => {
  it('does nothing and does not throw when no tokens are configured', async () => {
    const { deps, funded } = makeDeps({ configs: [] });
    const results = await seedWallet(WALLET, deps);
    expect(results).toEqual([]);
    expect(funded).toEqual([]);
  });

  it('funds a token when the wallet balance is below the target amount', async () => {
    const { deps, funded } = makeDeps({ balances: { TOKEN_A: 0n } });
    const results = await seedWallet(WALLET, deps);
    expect(funded).toEqual([{ tokenId: 'TOKEN_A', amount: 100n }]);
    expect(results[0]).toMatchObject({ tokenId: 'TOKEN_A', status: 'funded' });
  });

  it('skips a token the wallet already holds enough of', async () => {
    const { deps, funded } = makeDeps({ balances: { TOKEN_A: 100n } });
    const results = await seedWallet(WALLET, deps);
    expect(funded).toEqual([]);
    expect(results[0]).toMatchObject({ tokenId: 'TOKEN_A', status: 'skipped' });
  });

  it('continues seeding other tokens when one transfer fails', async () => {
    const funded: { tokenId: string }[] = [];
    const deps: SeedDeps = {
      configs: [{ tokenId: 'BAD', amount: 50n }, { tokenId: 'GOOD', amount: 50n }],
      getBalance: async () => 0n,
      fund: async (tokenId) => {
        if (tokenId === 'BAD') throw new Error('relayer has no BAD');
        funded.push({ tokenId });
        return 'hash_GOOD';
      },
    };
    const results = await seedWallet(WALLET, deps);
    expect(funded).toEqual([{ tokenId: 'GOOD' }]);
    expect(results.find((r) => r.tokenId === 'BAD')).toMatchObject({ status: 'failed' });
    expect(results.find((r) => r.tokenId === 'GOOD')).toMatchObject({ status: 'funded' });
  });
});
