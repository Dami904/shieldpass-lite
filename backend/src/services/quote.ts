/**
 * Swap quoting - converts supported Stellar assets into a public NGN payout quote.
 *
 * ZK boundary: the proof only spends exact shielded token units and proves compliance.
 * The fiat quote is public off-ramp data, recalculated by the backend at execution time
 * instead of trusted from the browser.
 */

const PRICE_TTL_MS = Number(process.env.SWAP_PRICE_TTL_MS || 60_000);
const PRICE_TIMEOUT_MS = Number(process.env.SWAP_PRICE_TIMEOUT_MS || 2500);

interface RateEntry {
  label: string;
  rate: number;
  source: string;
  updatedAt: string;
}

interface AssetPricing {
  label: string;
  coingeckoId: string;
  fallbackRate: number;
}

const SUPPORTED_ASSETS: Record<string, AssetPricing> = {
  XLM: { label: 'XLM', coingeckoId: 'stellar', fallbackRate: Number(process.env.SWAP_XLM_FALLBACK_NGN || 150) },
  USDC: { label: 'USDC', coingeckoId: 'usd-coin', fallbackRate: Number(process.env.SWAP_USDC_FALLBACK_NGN || 1650) },
};

function parseRates(raw: string | undefined): Map<string, RateEntry> {
  const map = new Map<string, RateEntry>();
  if (!raw) return map;
  for (const part of raw.split(',').map((p) => p.trim()).filter(Boolean)) {
    const [addr, label, rate] = part.split(':').map((s) => s.trim());
    if (addr && rate) {
      map.set(addr, {
        label: label || 'TOKEN',
        rate: Number(rate),
        source: 'env',
        updatedAt: new Date().toISOString(),
      });
    }
  }
  return map;
}

const RATES = parseRates(process.env.SWAP_RATES);
let liveCache: { expiresAt: number; rates: Map<string, RateEntry> } = { expiresAt: 0, rates: new Map() };

export interface Quote {
  tokenAddress: string;
  assetCode: string;
  tokenLabel: string;
  cryptoAmount: number;
  rate: number;
  nairaAmount: number;
  source: string;
  updatedAt: string;
}

function fallbackEntry(code: string): RateEntry {
  const asset = SUPPORTED_ASSETS[code];
  return {
    label: asset?.label ?? code,
    rate: asset?.fallbackRate ?? Number(process.env.SWAP_DEFAULT_RATE || 1650),
    source: 'fallback',
    updatedAt: new Date().toISOString(),
  };
}

async function fetchLiveRates(): Promise<Map<string, RateEntry>> {
  const now = Date.now();
  if (liveCache.expiresAt > now) return liveCache.rates;
  if ((process.env.SWAP_PRICE_MODE || 'live').toLowerCase() === 'static') return new Map();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PRICE_TIMEOUT_MS);
  try {
    const ids = Object.values(SUPPORTED_ASSETS).map((a) => a.coingeckoId).join(',');
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=ngn&include_last_updated_at=true`, {
      signal: controller.signal,
      headers: process.env.COINGECKO_API_KEY ? { 'x-cg-demo-api-key': process.env.COINGECKO_API_KEY } : undefined,
    });
    if (!res.ok) throw new Error(`price provider returned ${res.status}`);
    const data = await res.json() as Record<string, { ngn?: number; last_updated_at?: number }>;
    const rates = new Map<string, RateEntry>();
    for (const [code, asset] of Object.entries(SUPPORTED_ASSETS)) {
      const item = data[asset.coingeckoId];
      if (typeof item?.ngn === 'number' && Number.isFinite(item.ngn)) {
        rates.set(code, {
          label: asset.label,
          rate: item.ngn,
          source: 'coingecko',
          updatedAt: item.last_updated_at ? new Date(item.last_updated_at * 1000).toISOString() : new Date().toISOString(),
        });
      }
    }
    liveCache = { expiresAt: now + PRICE_TTL_MS, rates };
    return rates;
  } catch (err) {
    console.warn('[quote] live price unavailable, using fallback rates:', err);
    liveCache = { expiresAt: now + 10_000, rates: new Map() };
    return liveCache.rates;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getQuote(tokenAddress: string, cryptoAmount: number, assetCode?: string): Promise<Quote> {
  const code = String(assetCode || '').toUpperCase();
  if (!SUPPORTED_ASSETS[code]) throw new Error('Unsupported asset. Use XLM or USDC.');

  const liveRates = await fetchLiveRates();
  const entry = RATES.get(tokenAddress) ?? liveRates.get(code) ?? fallbackEntry(code);
  const nairaAmount = Math.round(cryptoAmount * entry.rate * 100) / 100;
  return {
    tokenAddress,
    assetCode: code,
    tokenLabel: entry.label,
    cryptoAmount,
    rate: entry.rate,
    nairaAmount,
    source: entry.source,
    updatedAt: entry.updatedAt,
  };
}

/** Swaps whose Naira value exceeds this require a Tier 2 (BVN) proof. */
export const TIER2_THRESHOLD_NAIRA = Number(process.env.TIER2_THRESHOLD_NAIRA || 1_000_000);
