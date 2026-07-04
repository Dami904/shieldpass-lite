export type FiatMode = 'mock' | 'live';

export function fiatMode(): FiatMode | null {
  const mode = (process.env.FIAT_MODE || '').toLowerCase();
  return mode === 'mock' || mode === 'live' ? mode : null;
}

export function fiatModeError(provider: string): string {
  return `${provider} requires FIAT_MODE=mock for demo payouts or FIAT_MODE=live with real credentials.`;
}
