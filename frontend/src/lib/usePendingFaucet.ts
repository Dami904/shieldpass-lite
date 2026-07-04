import { useEffect } from "react";
import { api } from "./api";
import { useSession } from "./session";
import { proveAndConfirm } from "./useInsertProof";

const POLL_MS = 3000;
const MAX_POLLS = 40; // ~2 min — covers faucet_seed + pool funding + self-healing retries.

/**
 * Drives a new-account faucet note that is settling on-chain in the BACKGROUND.
 *
 * The faucet is only shown once it's real ("hide-until-settled"): we poll GET /kyc/faucet-status
 * until the backend reports the note is backed (pool funded) and its tree index is reserved. Only
 * then do we (1) add it to the shielded balance and (2) generate the merkle_insert proof
 * CLIENT-SIDE — server-side proving OOM-crashes the backend, so all proving stays in the browser.
 *
 * If settling never succeeds (poll times out), the public fallback landed in the wallet balance
 * instead, so we simply drop the pending marker. Mounted app-wide (MainLayout) so it survives the
 * navigation away from onboarding.
 */
export function usePendingFaucet() {
  const session = useSession();
  const pending = session.pendingFaucet;

  useEffect(() => {
    if (!pending) return;
    let stopped = false;
    let polls = 0;

    async function tick() {
      if (stopped || !pending) return;
      polls += 1;
      try {
        const status = await api.faucetStatus(pending.commitment);
        if (status.state === "settled") {
          stopped = true;
          // The note is now backed + reserved. Add it to the balance (dedup by randomness makes
          // this idempotent), then prove + insert the leaf client-side so it becomes spendable.
          session.addNote({
            amount: pending.amount, asset: pending.asset, randomness: pending.randomness,
            leafIndex: status.leafIndex, compliance: pending.compliance, confirmed: false,
          });
          session.set({ pendingFaucet: null });
          proveAndConfirm(status.leafIndex, status.circuitInput)
            .then(() => session.confirmNote(status.leafIndex))
            .catch(() => { /* session auto-retry re-proves stuck leaves on next load */ });
          return;
        }
      } catch {
        /* network hiccup — keep polling */
      }
      if (polls >= MAX_POLLS) {
        // Gave up: settling failed and the public fallback (if any) is in the wallet balance.
        stopped = true;
        session.set({ pendingFaucet: null });
        return;
      }
      if (!stopped) setTimeout(tick, POLL_MS);
    }

    tick();
    return () => { stopped = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending?.commitment]);
}
