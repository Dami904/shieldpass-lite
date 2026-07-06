import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import ErrorNotice from "../components/ErrorNotice";
import ShieldedBalance from "../components/ShieldedBalance";
import ReceiveModal from "../components/ReceiveModal";
import type { SwapRecord } from "../types";
import { assetByCode, assetLabel, formatUnits } from "../lib/assets";
import { useAutoShield } from "../lib/useAutoShield";
import { useInsertProof } from "../lib/useInsertProof";

const fadeUp = {
  hidden: { opacity: 0, y: 30, filter: "blur(6px)", scale: 0.98 },
  visible: { opacity: 1, y: 0, filter: "blur(0px)", scale: 1, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] as any } },
};
const stagger = { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.1, delayChildren: 0.15 } } };

export default function DashboardPage() {
  const session = useSession();
  const address = session.address;
  const email = session.email;

  const [history, setHistory] = useState<SwapRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<unknown>(null);

  // Lite has no manual "Shield" button — anything that lands in the public wallet is shielded
  // automatically (one passkey confirmation per deposit, no other step).
  const { insertProof } = useInsertProof();
  const { autoShieldStatus } = useAutoShield(session, insertProof);

  // Proactive BVN card: SwapPage still gates this behind a large-swap threshold, but Lite also
  // lets anyone verify upfront from the dashboard so they're never interrupted mid-swap.
  const [bvn, setBvn] = useState("");
  const [bvnError, setBvnError] = useState<string | null>(null);
  const [verifyingBvn, setVerifyingBvn] = useState(false);

  async function handleBvnVerify() {
    setBvnError(null);
    if (!/^\d{11}$/.test(bvn)) { setBvnError("Enter a valid 11-digit BVN."); return; }
    try {
      setVerifyingBvn(true);
      const r = await api.submitBvn({ email: session.email, bvn });
      session.set({ name: r.returnedName, secretSalt: r.secretSalt, merkleRoot: r.merkleRoot, bvnVerified: true });
      setBvn("");
    } catch (err: any) {
      setBvnError(err.message || "Verification failed.");
    } finally {
      setVerifyingBvn(false);
    }
  }

  const [copied, setCopied] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const handleCopy = () => {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  useEffect(() => {
    if (!email) return;
    setHistoryLoading(true);
    setHistoryError(null);
    api.swapHistory(email)
      .then(setHistory)
      .catch((err) => setHistoryError(err))
      .finally(() => setHistoryLoading(false));
  }, [email]);

  return (
    <motion.div className="flex flex-col items-center w-full pt-4 sm:pt-6 pb-20 relative z-10" variants={stagger} initial="hidden" animate="visible">
      <div className="w-full max-w-4xl">
        <motion.div variants={fadeUp} className="flex flex-col md:flex-row md:items-baseline justify-between mb-8 sm:mb-10 gap-4">
          <div>
            <h1 className="geist-heading text-3xl sm:text-4xl md:text-5xl bg-gradient-to-r from-white via-white to-white/50 bg-clip-text text-transparent font-medium">Portfolio Dashboard</h1>
            <p className="text-white/40 text-sm mt-2 font-light">Your smart-wallet balances and zero-knowledge swap history.</p>
          </div>
          <div className="flex items-center gap-2 self-start md:self-auto">
            <button onClick={() => setReceiveOpen(true)} className="px-5 py-2.5 rounded-full font-mono text-xs border border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/20 transition-all flex items-center gap-2 text-white">
              Receive privately
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m4-8h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" /></svg>
            </button>
            <Link to="/withdraw" className="px-5 py-2.5 rounded-full font-mono text-xs border border-white/10 bg-white/5 hover:bg-white/10 transition-all flex items-center gap-2 group text-white">
              Swap Crypto
              <svg className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </Link>
          </div>
        </motion.div>
        <ReceiveModal open={receiveOpen} onClose={() => setReceiveOpen(false)} />

        {autoShieldStatus && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-8 flex items-center gap-3 border border-indigo-500/20 bg-indigo-500/[0.04] text-indigo-200 text-sm px-5 py-3.5 rounded-2xl">
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-indigo-400" />
            </span>
            {autoShieldStatus}
          </motion.div>
        )}

        <motion.div variants={fadeUp} className="mb-12">
          <div className="bg-gradient-to-br from-blue-900/30 to-indigo-900/20 backdrop-blur-xl rounded-3xl p-6 flex flex-col sm:flex-row items-center justify-between gap-6 border border-blue-500/20 shadow-2xl">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                <svg className="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
              </div>
              <div>
                <h3 className="font-medium text-white">Passkey Smart Wallet</h3>
                <div 
                  className="flex items-center gap-2 mt-0.5 cursor-pointer hover:opacity-80 transition-opacity" 
                  onClick={handleCopy}
                  title="Click to copy full address"
                >
                  <p className="text-white/40 text-xs font-mono">{address ? `${address.slice(0, 8)}…${address.slice(-6)}` : "Not connected"}</p>
                  {address && (
                    copied ? (
                      <svg className="w-3.5 h-3.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    ) : (
                      <svg className="w-3.5 h-3.5 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                    )
                  )}
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        {!address && (
          <motion.div variants={fadeUp} className="bg-gradient-to-br from-blue-900/30 to-indigo-900/20 backdrop-blur-xl rounded-[2rem] p-12 text-center border border-blue-500/20 shadow-2xl relative overflow-hidden text-blue-50">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 bg-indigo-500/5 rounded-full blur-[80px]" />
            <p className="text-white/60 text-sm max-w-sm mx-auto leading-relaxed">Onboard to pull live on-chain balances and your swap history.</p>
            <Link to="/onboarding" className="mt-6 inline-block font-mono text-xs px-6 py-3 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-500 transition-colors">Start Onboarding</Link>
          </motion.div>
        )}

        {address && (
          <div className="space-y-12">
            <motion.section variants={fadeUp}>
              <ShieldedBalance />
            </motion.section>

            <motion.section variants={fadeUp}>
              <h2 className="geist-heading text-xl sm:text-2xl mb-4 sm:mb-6 flex items-center gap-3 text-white font-medium">
                <svg className="w-5 h-5 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                Identity Verification
              </h2>
              {session.bvnVerified ? (
                <div className="bg-gradient-to-br from-emerald-900/20 to-emerald-800/10 backdrop-blur-xl border border-emerald-500/20 rounded-3xl p-6 flex items-center gap-3 text-emerald-300 text-sm">
                  <span className="relative flex h-3 w-3 shrink-0">
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-400" />
                  </span>
                  Tier 2 verified — high-value swaps are unlocked, no BVN prompt will interrupt you again.
                </div>
              ) : (
                <div className="bg-gradient-to-br from-blue-900/30 to-indigo-900/20 backdrop-blur-xl border border-blue-500/20 shadow-2xl rounded-3xl p-6 space-y-4">
                  <p className="text-white/50 text-xs leading-relaxed">
                    Optional — verify your BVN now to unlock high-value swaps upfront, instead of being asked mid-swap later. Only a pass/fail flag is stored; your name and BVN are never saved.
                  </p>
                  {bvnError && <p className="text-red-400 text-xs">{bvnError}</p>}
                  <div className="flex flex-col sm:flex-row gap-3">
                    <input
                      type="text" maxLength={11} value={bvn}
                      onChange={(e) => setBvn(e.target.value.replace(/\D/g, ""))}
                      placeholder="11-digit BVN"
                      className="flex-1 bg-white/[0.03] border border-white/10 rounded-xl px-4 py-3 text-white text-sm font-mono outline-none focus:border-indigo-500/40 transition-colors"
                    />
                    <button
                      onClick={handleBvnVerify}
                      disabled={verifyingBvn || bvn.length !== 11}
                      className="px-6 py-3 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                    >
                      {verifyingBvn ? "Verifying…" : "Verify BVN"}
                    </button>
                  </div>
                </div>
              )}
            </motion.section>

            <motion.section variants={fadeUp}>
              <h2 className="geist-heading text-xl sm:text-2xl mb-4 sm:mb-6 flex items-center gap-3 text-white font-medium">
                <svg className="w-5 h-5 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
                Swap History
              </h2>
              {historyLoading && <div className="flex items-center gap-3 opacity-60 text-sm border border-white/5 bg-white/[0.01] p-6 rounded-2xl">Loading swap history…</div>}
              {historyError ? <ErrorNotice error={historyError} className="border border-red-500/20 bg-red-500/[0.02] p-6 rounded-2xl" /> : null}
              {!historyLoading && !historyError && history.length === 0 && (
                <div className="bg-white/5 rounded-2xl p-10 text-center border border-white/5 shadow-md"><p className="text-white/50 text-sm">No swaps yet. Your settlements will appear here.</p></div>
              )}
              {!historyLoading && !historyError && history.length > 0 && (
                <div className="bg-gradient-to-br from-blue-900/30 to-indigo-900/20 backdrop-blur-xl rounded-3xl overflow-hidden divide-y divide-white/10 border border-blue-500/20 shadow-2xl">
                  {history.map((t, i) => (
                    <motion.div key={t.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05, duration: 0.3 }} className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 sm:p-6 hover:bg-white/5 transition-colors gap-4">
                      <div className="flex flex-col sm:flex-row items-start sm:items-baseline gap-2 sm:gap-6 w-full">
                        <span className={`font-mono text-[10px] uppercase tracking-widest w-16 text-xs text-indigo-400`}>SELL</span>
                        <div className="flex items-baseline gap-1.5">
                          <span className="geist-heading text-xl font-light text-white">
                            {formatUnits(t.cryptoAmountUnits || String(Math.round(t.cryptoAmount * 1e7)), assetByCode(t.assetCode)?.decimals ?? 7, 4)}
                          </span>
                          <span className="text-xs font-semibold text-white/50">{assetLabel(t.assetCode)}</span>
                        </div>
                        <span className="font-mono text-sm text-white/60">₦{t.nairaAmount.toLocaleString()}</span>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <span className={`font-mono text-[10px] px-3.5 py-1.5 rounded-full border flex items-center gap-2 ${t.status.toUpperCase() === "COMPLETED" || t.status.toUpperCase() === "SUCCESS" ? "text-green-400 border-green-400/20 bg-green-400/5 font-semibold" : "text-white/50 border-white/10 bg-white/5"}`}>
                          {(t.status.toUpperCase() === "COMPLETED" || t.status.toUpperCase() === "SUCCESS") && (
                            <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span></span>
                          )}
                          {t.status}
                        </span>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.section>
          </div>
        )}
      </div>
    </motion.div>
  );
}
