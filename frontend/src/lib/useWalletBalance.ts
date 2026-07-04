import { useState, useEffect } from "react";
import { PUBLIC_ASSETS, formatUnits } from "./assets";

const RPC_URL = import.meta.env.VITE_RPC_URL || "https://soroban-testnet.stellar.org";

/**
 * Fetches the on-chain (public) wallet balance for a given asset and address.
 * Returns null while loading or if the fetch fails.
 */
export function useWalletBalance(assetCode: string, address: string | null | undefined) {
  const [balance, setBalance] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!address || !assetCode) { setBalance(null); return; }
    const asset = PUBLIC_ASSETS.find((a) => a.code === assetCode);
    if (!asset) { setBalance(null); return; }

    let cancelled = false;
    setLoading(true);
    setBalance(null);
    (async () => {
      try {
        const { StellarContractClient } = await import("@shieldpass/sdk/dist/stellar");
        const { Networks } = await import("@stellar/stellar-sdk");
        const client = new StellarContractClient(RPC_URL, Networks.TESTNET, asset.sac as string);
        const raw = await client.getTokenBalance(asset.sac as string, address);
        if (!cancelled) setBalance(formatUnits(raw, asset.decimals, 4));
      } catch {
        if (!cancelled) setBalance(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [assetCode, address]);

  return { balance, loading };
}
