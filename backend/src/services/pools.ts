/**
 * Shielded-pool registry. Each asset has its OWN on-chain `shielded_pool` instance
 * (the contract is bound to a single token at init), so the backend tracks one merkle
 * tree per pool. This module is the single source of truth mapping a pool contract id
 * (or asset code) to its config.
 *
 * Env:
 *   STELLAR_CONTRACT_ID       — the XLM pool (default pool; faucet notes are seeded here)
 *   XLM_SAC_ADDRESS           — XLM SAC, used to fund the XLM pool for faucet notes
 *   USDC_POOL_CONTRACT_ID     — the USDC pool (optional; enables shielded USDC)
 *   USDC_SAC_ADDRESS          — USDC SAC (optional; for parity/funding)
 *   FAUCET_NOTE_AMOUNT        — XLM faucet note size (stroops)
 */

export interface PoolConfig {
  /** On-chain shielded_pool contract id. May be '' when unconfigured (e.g. in tests). */
  poolId: string;
  /** Asset code this pool holds. */
  asset: 'XLM' | 'USDC';
  /** The pool's bound token SAC address (for funding). '' if unset. */
  sacAddress: string;
  /** Whether new wallets receive a faucet note in this pool (XLM only). */
  faucet: boolean;
  /** Faucet note size in stroops (only meaningful when `faucet`). */
  faucetAmount: bigint;
}

function buildRegistry(): Map<string, PoolConfig> {
  const m = new Map<string, PoolConfig>();

  // XLM pool — always the default. Present even when unconfigured ('') so the service
  // is constructible in tests; chain ops guard on a non-empty poolId.
  const xlmPool = process.env.STELLAR_CONTRACT_ID || '';
  m.set(xlmPool, {
    poolId: xlmPool,
    asset: 'XLM',
    sacAddress: process.env.XLM_SAC_ADDRESS || '',
    faucet: true,
    faucetAmount: BigInt(process.env.FAUCET_NOTE_AMOUNT || '1000000000'),
  });

  // USDC pool — only when explicitly configured. USDC is never faucet-seeded; it enters
  // the system via real external transfers, then the user shields it.
  const usdcPool = process.env.USDC_POOL_CONTRACT_ID || '';
  if (usdcPool) {
    m.set(usdcPool, {
      poolId: usdcPool,
      asset: 'USDC',
      sacAddress: process.env.USDC_SAC_ADDRESS || '',
      faucet: false,
      faucetAmount: 0n,
    });
  }

  return m;
}

// Built once at startup from env.
const REGISTRY = buildRegistry();

/** The default pool id (XLM). Used when a request omits an explicit pool. */
export function defaultPoolId(): string {
  return process.env.STELLAR_CONTRACT_ID || '';
}

/** All configured pool ids (for cross-pool maintenance like cleanup). */
export function allPoolIds(): string[] {
  return [...REGISTRY.keys()];
}

/**
 * Resolve a pool by its contract id. Falls back to the default (XLM) pool when `poolId`
 * is omitted/empty. Returns undefined for an unknown, non-empty id (so callers reject it
 * rather than silently routing to the wrong tree).
 */
export function getPoolConfig(poolId?: string): PoolConfig | undefined {
  if (!poolId) return REGISTRY.get(defaultPoolId());
  return REGISTRY.get(poolId);
}

/** Resolve a pool by asset code (e.g. when a route sends assetCode instead of poolId). */
export function poolIdForAsset(asset: string): string | undefined {
  const want = String(asset || '').toUpperCase();
  for (const cfg of REGISTRY.values()) if (cfg.asset === want) return cfg.poolId;
  return undefined;
}
