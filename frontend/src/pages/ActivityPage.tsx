import { useEffect } from "react";
import { motion } from "motion/react";
import { useNotifications } from "../lib/useNotifications";

const META: Record<string, { label: string; color: string }> = {
  FAUCET: { label: "Welcome bonus", color: "text-indigo-300" },
  SHIELD: { label: "Shielded", color: "text-emerald-300" },
  UNSHIELD: { label: "Unshielded", color: "text-amber-300" },
  WITHDRAW_FIAT: { label: "Withdrawn to Naira", color: "text-emerald-300" },
  SEND_PUBLIC: { label: "Sent", color: "text-white/70" },
  SEND_SHIELDED: { label: "Sent privately", color: "text-indigo-300" },
  RECEIVE_SHIELDED: { label: "Private payment received", color: "text-emerald-300" },
  RECEIVE_PUBLIC: { label: "Received", color: "text-emerald-300" },
  PAYOUT_SETTLED: { label: "Payout settled", color: "text-emerald-300" },
};

export default function ActivityPage() {
  const { items, markRead } = useNotifications();
  useEffect(() => { markRead(); }, [markRead]);

  return (
    <motion.div className="flex flex-col items-center w-full pt-4 sm:pt-6 pb-20 relative z-10" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="w-full max-w-lg">
        <h1 className="geist-heading text-3xl sm:text-4xl bg-gradient-to-r from-white via-white to-white/50 bg-clip-text text-transparent font-medium text-center mb-8">
          Activity
        </h1>

        {items.length === 0 ? (
          <div className="text-white/40 text-sm text-center border border-white/10 bg-white/[0.02] rounded-2xl p-10">
            Nothing here yet — your shields, sends, withdrawals and received payments will show up here.
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((n) => {
              const m = META[n.type] ?? { label: n.type, color: "text-white/70" };
              return (
                <div key={n.id} className={`flex items-center justify-between rounded-xl border p-4 ${n.read ? "border-white/5 bg-white/[0.01]" : "border-indigo-500/20 bg-indigo-500/[0.04]"}`}>
                  <div>
                    <div className={`text-sm font-medium flex items-center gap-1.5 ${m.color}`}>
                      {n.title}
                      {n.txHash && (
                        <a href={`https://stellar.expert/explorer/testnet/tx/${n.txHash}`} target="_blank" rel="noopener noreferrer" className="text-white/30 hover:text-white/70 transition-colors text-xs font-mono" title="View on Stellar Explorer">
                          ↗
                        </a>
                      )}
                    </div>
                    <div className="text-white/30 text-xs mt-0.5">{new Date(n.createdAt).toLocaleString()}</div>
                  </div>
                  {n.amount && (
                    <div className="text-white/80 text-sm font-mono whitespace-nowrap">
                      {n.amount} <span className="text-white/40">{n.asset ?? ""}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </motion.div>
  );
}
