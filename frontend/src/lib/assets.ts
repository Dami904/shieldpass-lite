export interface SupportedAsset {
  code: 'XLM' | 'USDC';
  name: string;
  sac: string;
  poolContractId: string;
  decimals: number;
}

const fallbackPool = import.meta.env.VITE_ESCROW_CONTRACT_ID as string | undefined;

const assets: SupportedAsset[] = [
  {
    code: 'XLM',
    name: 'Stellar Lumens',
    sac: import.meta.env.VITE_XLM_SAC as string,
    poolContractId: (import.meta.env.VITE_XLM_POOL_CONTRACT_ID || fallbackPool) as string,
    decimals: 7,
  },
  {
    code: 'USDC',
    name: 'USD Coin',
    sac: import.meta.env.VITE_USDC_SAC as string,
    poolContractId: (import.meta.env.VITE_USDC_POOL_CONTRACT_ID || fallbackPool) as string,
    decimals: 7,
  },
];

export const SUPPORTED_ASSETS = assets.filter((a) => !!a.sac && !!a.poolContractId);
export const PUBLIC_ASSETS = assets.filter((a) => !!a.sac);

export function assetByCode(code: string | null | undefined): SupportedAsset | undefined {
  return assets.find((a) => a.code === String(code || '').toUpperCase());
}

export function assetLabel(code: string | null | undefined): string {
  const asset = assetByCode(code);
  return asset ? asset.code : String(code || 'TOKEN').toUpperCase();
}

export function parseUnits(input: string, decimals = 7): bigint {
  const trimmed = input.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) throw new Error('Enter a valid amount.');
  const [whole, fraction = ''] = trimmed.split('.');
  if (fraction.length > decimals) throw new Error(`Use at most ${decimals} decimal places.`);
  return BigInt(whole + fraction.padEnd(decimals, '0'));
}

export function formatUnits(units: bigint | string, decimals = 7, maxFractionDigits = 7): string {
  const raw = typeof units === 'bigint' ? units.toString() : units;
  const negative = raw.startsWith('-');
  const digits = negative ? raw.slice(1) : raw;
  const padded = digits.padStart(decimals + 1, '0');
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, '').slice(0, maxFractionDigits);
  return `${negative ? '-' : ''}${Number(whole).toLocaleString()}${fraction ? `.${fraction}` : ''}`;
}
