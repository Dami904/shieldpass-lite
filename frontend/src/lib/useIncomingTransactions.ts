import { useEffect, useRef } from "react";
import { rpc, scValToNative } from "@stellar/stellar-sdk";
import { useSession } from "./session";
import { api } from "./api";
import { formatUnits, SUPPORTED_ASSETS } from "./assets";

const RPC_URL = import.meta.env.VITE_RPC_URL || "https://soroban-testnet.stellar.org";
const POLL_MS = 20_000;
const LEDGERS_LOOKBACK = 100; // ~8 min of history on first load
// The shielded pools (one per asset). Transfers FROM any of them (unshields / swap payouts)
// are already announced by their own flow, so we must not double-notify them as a generic
// public "Received". Covers every configured pool, not just XLM.
const POOL_CONTRACTS = new Set(
  [import.meta.env.VITE_ESCROW_CONTRACT_ID as string | undefined, ...SUPPORTED_ASSETS.map((a) => a.poolContractId)]
    .filter((id): id is string => !!id),
);

// Map SAC contract address → { code, decimals }
function buildSacMeta(): Record<string, { code: string; decimals: number }> {
  const meta: Record<string, { code: string; decimals: number }> = {};
  const xlm = import.meta.env.VITE_XLM_SAC as string;
  const usdc = import.meta.env.VITE_USDC_SAC as string;
  const ngnc = import.meta.env.VITE_NGNC_SAC as string;
  if (xlm) meta[xlm] = { code: "XLM", decimals: 7 };
  if (usdc) meta[usdc] = { code: "USDC", decimals: 7 };
  if (ngnc) meta[ngnc] = { code: "NGNC", decimals: 7 };
  return meta;
}

const SAC_META = buildSacMeta();

export function useIncomingTransactions() {
  const session = useSession();
  const runningRef = useRef(false);

  useEffect(() => {
    if (!session.address || !session.email) return;

    const address = session.address;
    const email = session.email;
    const cursorKey = `shieldpass_incoming_cursor_${address}`;
    const seenKey = `shieldpass_incoming_seen_${address}`;
    const server = new rpc.Server(RPC_URL);
    const contracts = Object.keys(SAC_META);
    if (contracts.length === 0) return;

    async function poll() {
      if (runningRef.current) return;
      runningRef.current = true;
      try {
        const latest = await server.getLatestLedger();
        const storedCursor = localStorage.getItem(cursorKey);
        const startLedger = storedCursor
          ? Number(storedCursor)
          : Math.max(1, latest.sequence - LEDGERS_LOOKBACK);

        // Load seen event IDs to deduplicate within the lookback window
        let seen: Set<string>;
        try { seen = new Set(JSON.parse(localStorage.getItem(seenKey) || "[]")); }
        catch { seen = new Set(); }

        const result = await server.getEvents({
          startLedger,
          filters: [{ type: "contract", contractIds: contracts }],
        });

        // Advance cursor to next ledger after the latest we just fetched
        localStorage.setItem(cursorKey, String(latest.sequence + 1));

        for (const event of result.events) {
          if (event.topic.length < 3) continue;
          if (seen.has(event.id)) continue;

          let fn: unknown, from: unknown, to: unknown;
          try {
            fn = scValToNative(event.topic[0]);
            from = scValToNative(event.topic[1]);
            to = scValToNative(event.topic[2]);
          } catch { continue; }

          if (fn !== "transfer") continue;
          if (to !== address) continue; // not for us
          // Pool-originated transfer = an unshield or swap payout, already notified by its
          // own flow. Skip it here so the user doesn't get a duplicate "Received" alert.
          if (typeof from === "string" && POOL_CONTRACTS.has(from)) { seen.add(event.id); continue; }

          const contractId = typeof event.contractId === "string" ? event.contractId : event.contractId?.toString() ?? "";
          const meta = SAC_META[contractId];
          if (!meta) continue;

          let amountRaw: bigint;
          try { amountRaw = BigInt(scValToNative(event.value) as string | number | bigint); }
          catch { continue; }

          const formatted = formatUnits(amountRaw, meta.decimals, 4);

          api.notify({
            email,
            type: "RECEIVE_PUBLIC",
            title: `Received ${formatted} ${meta.code}`,
            amount: formatted,
            asset: meta.code,
            txHash: event.txHash,
          }).catch(() => {});

          seen.add(event.id);
        }

        // Persist seen set (cap at 500 entries to avoid unbounded growth)
        const seenArr = [...seen];
        localStorage.setItem(seenKey, JSON.stringify(seenArr.slice(-500)));
      } catch {
        // silent — polling failure should not surface to UI
      } finally {
        runningRef.current = false;
      }
    }

    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [session.address, session.email]);
}
