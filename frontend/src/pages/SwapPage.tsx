import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import ShieldedKeyGate from "../components/ShieldedKeyGate";
import { useSwapProof } from "../lib/useSwapProof";
import { useInsertProof } from "../lib/useInsertProof";
import ErrorNotice from "../components/ErrorNotice";
import { Buffer } from "buffer";
import { encryptNote } from "@shieldpass/sdk/dist/identity";
import type { BankAccount, Quote } from "../types";
import { SUPPORTED_ASSETS as SUPPORTED_SWAP_ASSETS, assetByCode, parseUnits, formatUnits } from "../lib/assets";
import { addBank, loadBanks } from "../lib/bankVault";

const buf = (u8: Uint8Array): Buffer => Buffer.from(u8);
// Random 254-bit field element (decimal) for the per-swap bank blinding salt.
function randomSalt(): bigint {
  const a = new Uint8Array(31);
  crypto.getRandomValues(a);
  let h = "0x";
  for (const b of a) h += b.toString(16).padStart(2, "0");
  return BigInt(h);
}

const fadeUp = {
  hidden: { opacity: 0, y: 30, filter: "blur(6px)", scale: 0.98 },
  visible: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    scale: 1,
    transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] as any },
  },
};

const stagger = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.15 },
  },
};



export default function SwapPage() {
  const navigate = useNavigate();
  const session = useSession();
  const swapProof = useSwapProof(import.meta.env.VITE_API_URL as string);
  const { insertProof } = useInsertProof();

  // Swap State
  const [assetType, setAssetType] = useState<string>(SUPPORTED_SWAP_ASSETS[0]?.code ?? "");
  const [cryptoAmount, setCryptoAmount] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const [swapSuccess, setSwapSuccess] = useState<{ message: string; txHash?: string } | null>(null);
  const [swapping, setSwapping] = useState(false);

  // Bank Account State
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [selectedBankId, setSelectedBankId] = useState<string>("");
  const [showAddBank, setShowAddBank] = useState(false);

  // New Bank Form State
  const [bankCode, setBankCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [lencoBanks, setLencoBanks] = useState<{ code: string; name: string }[]>([]);
  const [bankSearch, setBankSearch] = useState("");
  const [addingBank, setAddingBank] = useState(false);
  const [isBankDropdownOpen, setIsBankDropdownOpen] = useState(false);
  const [isSavedBankDropdownOpen, setIsSavedBankDropdownOpen] = useState(false);

  // BVN Modal State
  const [showBvnModal, setShowBvnModal] = useState(false);
  const [bvn, setBvn] = useState("");
  const [bvnError, setBvnError] = useState<string | null>(null);
  const [verifyingBvn, setVerifyingBvn] = useState(false);

  const proving = swapProof.status === "fetching-path" || swapProof.status === "loading-circuit" || swapProof.status === "generating";

  const selectedSwapAsset = assetByCode(assetType);
  const shieldedSwapTotal = session.notes
    .filter((n) => (n.asset || "XLM") === assetType)
    .reduce((sum, n) => sum + BigInt(n.amount), 0n);
  const shieldedSwapBalance = formatUnits(shieldedSwapTotal, selectedSwapAsset?.decimals ?? 7, 4);

  // Load Lenco's full supported bank list (correct 6-digit codes) for the bank picker.
  useEffect(() => {
    api.banks().then((r) => setLencoBanks(r.banks || [])).catch(() => {});
  }, []);

  const bankNameByCode = (code?: string) => lencoBanks.find((b) => b.code === code)?.name || "";
  const filteredBanks = (bankSearch.trim()
    ? lencoBanks.filter((b) => b.name.toLowerCase().includes(bankSearch.trim().toLowerCase()))
    : lencoBanks
  ).slice(0, 60);

  useEffect(() => {
    if (session.email) {
      loadBanks(session.email)
        .then((saved) => {
          setBanks(saved);
          if (saved.length > 0 && !selectedBankId) setSelectedBankId(saved[0].id);
        })
        .catch(() => setBanks([]));
    }
  }, [session.email, session.identity]);

  useEffect(() => {
    const val = Number(cryptoAmount);
    if (!val || val <= 0) {
      setQuote(null);
      return;
    }
    const token = SUPPORTED_SWAP_ASSETS.find(a => a.code === assetType);
    if (!token) return;

    setQuoteLoading(true);
    const delay = setTimeout(() => {
      api.quote({ tokenAddress: token.sac, cryptoAmount: val, assetCode: token.code })
        .then(res => {
          setQuote(res);
          setActionError(null);
        })
        .catch(err => setActionError(err))
        .finally(() => setQuoteLoading(false));
    }, 500);
    return () => clearTimeout(delay);
  }, [cryptoAmount, assetType]);

  // Name enquiry: once a 10-digit account number + bank are entered, resolve the holder's name so
  // the user confirms the recipient before saving (prevents wrong-account payouts). Debounced.
  useEffect(() => {
    setResolveError(null);
    setAccountName("");
    if (!bankCode || !/^\d{10}$/.test(accountNumber)) { setResolving(false); return; }
    let cancelled = false;
    setResolving(true);
    const t = setTimeout(() => {
      api.resolveAccount({ accountNumber, bankCode })
        .then((r) => { if (!cancelled) setAccountName(r.accountName); })
        .catch((err: any) => { if (!cancelled) setResolveError(err?.message || "Could not verify this account."); })
        .finally(() => { if (!cancelled) setResolving(false); });
    }, 500);
    return () => { cancelled = true; clearTimeout(t); };
  }, [accountNumber, bankCode]);

  async function handleAddBank() {
    if (!bankCode || !/^\d{10}$/.test(accountNumber) || accountName.trim().length < 2) {
      setActionError("Enter a valid bank + 10-digit account number, and wait for the name to verify.");
      return;
    }
    const bankName = bankNameByCode(bankCode) || bankCode;
    try {
      setAddingBank(true);

      const newBank = {
        id: Math.random().toString(36).slice(2),
        bankName,
        bankCode,
        accountNumber,
        accountName,
        isDefault: false,
      };

      const updatedBanks = await addBank(session.email, newBank);
      setBanks(updatedBanks);

      setSelectedBankId(newBank.id);
      setShowAddBank(false);
      setBankCode("");
      setBankSearch("");
      setAccountNumber("");
      setAccountName("");
    } catch (err) {
      setActionError(err);
    } finally {
      setAddingBank(false);
    }
  }

  async function handleBvnUpgrade() {
    setBvnError(null);
    if (!/^\d{11}$/.test(bvn)) {
      setBvnError("Enter a valid 11-digit BVN.");
      return;
    }
    try {
      setVerifyingBvn(true);
      const r = await api.submitBvn({ email: session.email, bvn });
      session.set({ ...session, name: r.returnedName, secretSalt: r.secretSalt, merkleRoot: r.merkleRoot, bvnVerified: true });
      setShowBvnModal(false);
      handleSwap(true); // resume swap knowing bvn is now true
    } catch (err: any) {
      setBvnError(err.message || "Verification failed");
    } finally {
      setVerifyingBvn(false);
    }
  }

  async function handleSwap(skipBvnCheck = false) {
    setActionError(null);
    setSwapSuccess(null);

    if (!session.onboarded || !session.address || !session.wallet) {
      setActionError("Complete onboarding + connect your passkey first.");
      return;
    }
    if (!session.secretSalt || !session.merkleRoot) {
      setActionError("Missing attestation — re-onboard.");
      return;
    }
    if (!selectedBankId) {
      setActionError("Please select a bank account to receive the Naira.");
      return;
    }
    if (!quote || quote.nairaAmount <= 0) {
      setActionError("Invalid swap amount.");
      return;
    }

    // Progression: Tier 2 check
    if (quote.requireBvn && !session.bvnVerified && !skipBvnCheck) {
      setShowBvnModal(true);
      return;
    }

    const token = SUPPORTED_SWAP_ASSETS.find(a => a.code === assetType);
    if (!token) {
      setActionError("Missing smart contract config.");
      return;
    }

    try {
      setSwapping(true);

      if (!session.wallet || !session.address) {
        throw new Error("Wallet not connected. Please log in again.");
      }
      const swapAmt = parseUnits(cryptoAmount, token.decimals);
      const currentNote = session.notes.find((n) => n.asset === token.code && BigInt(n.amount) >= swapAmt);
      if (!currentNote) {
        throw new Error(`No single shielded ${token.code} note covers this amount. Shield more, or withdraw a smaller amount.`);
      }
      const selectedBank = banks.find(b => b.id === selectedBankId);
      if (!selectedBank) throw new Error("Bank details not found locally.");

      // 1. Prove the confidential swap in-browser (Groth16). Private note data stays local;
      //    the contract verifies the proof on-chain. Spends session.note, mints a change note.
      const pr = await swapProof.generate(
        currentNote,
        swapAmt,
        { accountNumber: BigInt(selectedBank.accountNumber.replace(/\D/g, "") || "0"), salt: randomSalt() },
        quote.requireBvn,
      );
      if (!pr) throw new Error(swapProof.error || "Proof generation failed.");

      // 2. Submit confidential_swap through the smart account (passkey-signed, gasless).
      //    The deployed contract's spec encodes Vec<BytesN<32>> from an array of 32-byte Buffers.
      const swapRes = await session.wallet.invoke(token.poolContractId, "confidential_swap", {
        proof_a: buf(pr.proof.a),
        proof_b: buf(pr.proof.b),
        proof_c: buf(pr.proof.c),
        public_signals: pr.publicSignals.map(buf),
        refund_commitment: buf(pr.refundCommitment),
      });
      const onChainSwapId = String(swapRes.result);

      // 3. Backend pays the Naira, claims the crypto, and inserts the change note into the tree.
      //    pr.publicSignals[1] is the change commitment (decimal) needed to advance the tree.
      const changeCommitment = BigInt("0x" + Buffer.from(pr.publicSignals[1]).toString("hex")).toString();
      const exec = await api.executeSwap({
        email: session.email,
        ephemeralBankDetails: {
          accountNumber: selectedBank.accountNumber,
          bankName: selectedBank.bankName,
          accountName: selectedBank.accountName,
          bankCode: selectedBank.bankCode,
        },
        tokenAddress: token.sac,
        assetCode: token.code,
        cryptoAmount: Number(cryptoAmount),
        cryptoAmountUnits: swapAmt.toString(),
        onChainSwapId,
        nullifier: pr.nullifier,
        changeCommitment,
      });

      // 4. Spend the note: drop it. If there's change, INSERT the change note on-chain
      //    (assign -> prove -> confirm, in the browser) exactly like unshield does — so the leaf
      //    actually lands and the backend tree only advances once it's confirmed. Previously the
      //    change note was never inserted, which drifted the tree and broke every later spend.
      if (BigInt(pr.changeNote.amount) > 0n) {
        const { index } = await insertProof(changeCommitment, () => {}, token.poolContractId);
        const changeNote = {
          amount: pr.changeNote.amount,
          asset: token.code,
          randomness: pr.changeNote.randomness,
          leafIndex: index,
          compliance: currentNote.compliance,
          confirmed: true, // insertProof above landed this leaf on-chain
        };
        session.set({ notes: [...session.notes.filter((n) => n !== currentNote), changeNote] });

        // Publish a SELF-addressed recovery blob for the change note so the shielded balance
        // survives logout / a new device (the note scanner rebuilds from these blobs).
        if (session.identity) {
          try {
            const plaintext = new TextEncoder().encode(JSON.stringify({
              amount: pr.changeNote.amount, randomness: pr.changeNote.randomness,
              compliance: currentNote.compliance, asset: token.code,
            }));
            const enc = encryptNote(session.identity.encPublic, plaintext);
            await api.postNoteBlob({
              commitment: changeCommitment,
              ephemeralPub: Buffer.from(enc.ephemeralPublic).toString("hex"),
              ciphertext: Buffer.from(enc.ciphertext).toString("hex"),
            });
          } catch (e) {
            console.warn("[swap] change recovery blob publish failed:", e);
          }
        }
      } else {
        // Fully spent — just drop the note.
        session.set({ notes: session.notes.filter((n) => n !== currentNote) });
      }

      setSwapSuccess({ message: `Success! ${exec.message}`, txHash: swapRes.hash });
      setCryptoAmount("");
      setQuote(null);
      api.notify({
        email: session.email,
        type: "WITHDRAW_FIAT",
        title: "Withdrawn to Naira",
        amount: formatUnits(swapAmt, token.decimals, 4),
        asset: token.code,
        txHash: swapRes.hash,
      }).catch(() => {});
    } catch (err) {
      setActionError(err);
    } finally {
      setSwapping(false);
    }
  }

  return (
    <motion.div
      className="flex flex-col items-center w-full pt-4 sm:pt-6 pb-20 relative z-10"
      variants={stagger} initial="hidden" animate="visible"
    >
      <div className="w-full max-w-lg">
        <motion.div variants={fadeUp} className="text-center mb-8">
          <h1 className="geist-heading text-3xl sm:text-4xl md:text-5xl text-white font-medium">
            Withdraw
          </h1>
          <p className="text-blue-200/60 text-sm mt-2 font-light">
            Trustless off-ramp. Crypto is time-locked until Naira hits your bank.
          </p>
        </motion.div>

        {actionError ? (
          <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="border border-red-500/20 bg-red-500/[0.02] p-4 rounded-2xl mb-6">
            <ErrorNotice error={actionError} />
          </motion.div>
        ) : null}

        {swapSuccess ? (
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="border border-green-500/20 bg-green-500/[0.02] p-6 rounded-2xl mb-6 text-center">
            <p className="text-green-400 font-medium">
              {swapSuccess.message}
              {swapSuccess.txHash && (
                <a href={`https://stellar.expert/explorer/testnet/tx/${swapSuccess.txHash}`} target="_blank" rel="noopener noreferrer" className="ml-2 inline-flex items-center gap-0.5 text-green-400/60 hover:text-green-300 transition-colors text-xs font-mono" title="View on Stellar Explorer">
                  ↗
                </a>
              )}
            </p>
            <button onClick={() => navigate("/dashboard")} className="mt-4 text-xs bg-white/5 hover:bg-white/10 px-4 py-2 rounded-lg transition-all font-mono">View Dashboard</button>
          </motion.div>
        ) : null}

        <motion.div variants={fadeUp} className="bg-gradient-to-br from-blue-900/30 to-indigo-900/20 backdrop-blur-xl border border-blue-500/20 shadow-2xl rounded-3xl p-6 sm:p-8 mb-8 space-y-6 font-display text-blue-50">
          {/* Pay Amount */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center px-1">
              <span className="text-xs text-white/50 font-medium uppercase tracking-wider">You Sell</span>
              <span className="text-[11px] text-white/35">Shielded: {shieldedSwapBalance} {assetType}</span>
            </div>
            <div className="flex bg-white/5 backdrop-blur-md border border-white/10 rounded-xl p-2 focus-within:border-indigo-400/50 transition-all shadow-lg">
              <input
                type="number" min="0" inputMode="decimal"
                className="w-full bg-transparent text-2xl px-3 outline-none text-white font-medium placeholder:text-white/20"
                value={cryptoAmount} onChange={(e) => setCryptoAmount(e.target.value)} placeholder="0.00"
              />
              <select
                className="bg-white/10 border border-white/10 rounded-lg px-3 py-2 text-white font-semibold outline-none cursor-pointer hover:bg-white/20 transition-colors"
                value={assetType} onChange={(e) => setAssetType(e.target.value)}
              >
                {SUPPORTED_SWAP_ASSETS.map((a) => <option key={a.code} value={a.code} className="bg-zinc-900">{a.code} - {a.name}</option>)}
              </select>
            </div>
          </div>

          {/* Receive Amount */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center px-1">
              <span className="text-xs text-white/50 font-medium uppercase tracking-wider">You Receive</span>
              {quoteLoading && <span className="text-xs text-indigo-400 animate-pulse">Calculating...</span>}
            </div>
            <div className="flex bg-white/5 backdrop-blur-md border border-white/10 rounded-xl p-4 transition-all opacity-80 shadow-lg">
              <span className="w-full bg-transparent text-2xl outline-none text-white font-medium">
                {quote ? `₦${quote.nairaAmount.toLocaleString()}` : "₦0.00"}
              </span>
              <span className="px-3 py-1 text-white/60 font-semibold text-lg">NGN</span>
            </div>
            {quote && (
              <p className="text-xs text-white/35 px-1 pt-1">
                1 {quote.assetCode} = NGN {quote.rate.toLocaleString(undefined, { maximumFractionDigits: 2 })} via {quote.source}
              </p>
            )}
            {quote && quote.requireBvn && !session.bvnVerified && (
              <p className="text-xs text-amber-400/80 px-1 pt-1">⚠️ This amount requires Tier 2 Identity Verification (BVN).</p>
            )}
          </div>

          {/* Payout Bank Selection */}
          <div className="pt-4 border-t border-white/5">
            <p className="text-xs text-white/50 font-medium mb-3">Send Naira To</p>
            {banks.length === 0 || showAddBank ? (
              <div className="space-y-3 bg-white/5 backdrop-blur-md border border-white/10 p-4 rounded-xl shadow-lg">
                <div className="relative">
                  <div
                    className="w-full bg-white/5 backdrop-blur-md border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm cursor-pointer hover:bg-white/10 transition-colors flex items-center justify-between shadow-inner"
                    onClick={() => setIsBankDropdownOpen(!isBankDropdownOpen)}
                  >
                    {bankCode ? (
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="w-5 h-5 rounded-full bg-indigo-500/30 text-[10px] flex items-center justify-center font-bold text-indigo-200 shrink-0">{(bankNameByCode(bankCode) || "?").charAt(0)}</span>
                        <span className="font-medium truncate">{bankNameByCode(bankCode) || "Selected bank"}</span>
                      </div>
                    ) : (
                      <span className="text-white/50">{lencoBanks.length ? "Select Bank..." : "Loading banks…"}</span>
                    )}
                    <svg className={`w-4 h-4 text-white/50 transition-transform duration-300 ${isBankDropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </div>

                  <AnimatePresence>
                    {isBankDropdownOpen && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                        className="w-full mt-2 bg-indigo-950/90 backdrop-blur-2xl border border-white/10 rounded-xl overflow-hidden"
                      >
                        <input
                          autoFocus value={bankSearch} onChange={e => setBankSearch(e.target.value)}
                          placeholder="Search bank…"
                          className="w-full bg-white/5 border-b border-white/10 px-4 py-2.5 text-sm text-white outline-none placeholder:text-white/30"
                        />
                        <div className="max-h-56 overflow-y-auto custom-scrollbar">
                          {filteredBanks.length === 0 ? (
                            <div className="px-4 py-3 text-sm text-white/40">{lencoBanks.length ? "No match" : "Loading banks…"}</div>
                          ) : filteredBanks.map(b => (
                            <div
                              key={b.code}
                              className="px-4 py-3 hover:bg-white/10 cursor-pointer flex items-center gap-3 transition-colors border-b border-white/5 last:border-0"
                              onClick={() => { setBankCode(b.code); setIsBankDropdownOpen(false); setBankSearch(""); }}
                            >
                              <span className="w-6 h-6 rounded-full bg-indigo-500/25 text-[11px] flex items-center justify-center font-bold text-indigo-200 shrink-0">{b.name.charAt(0)}</span>
                              <span className="text-sm text-white/90 font-medium truncate">{b.name}</span>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                <input className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white outline-none text-sm placeholder:text-white/20 transition-colors focus:border-indigo-500 focus:bg-white/10" maxLength={10} value={accountNumber} onChange={e => setAccountNumber(e.target.value.replace(/\D/g, ""))} placeholder="10-digit Account Number" />
                {/* Auto-resolved account name (name enquiry) — read-only so the user can't mistype it */}
                <div className={`w-full rounded-lg px-3 py-2 text-sm min-h-[38px] flex items-center border transition-colors ${accountName ? 'border-emerald-500/30 bg-emerald-500/[0.04]' : resolveError ? 'border-red-500/30 bg-red-500/[0.03]' : 'border-white/10 bg-white/5'}`}>
                  {resolving ? (
                    <span className="text-indigo-300 animate-pulse">Verifying account…</span>
                  ) : accountName ? (
                    <span className="text-emerald-300 font-medium truncate">✓ {accountName}</span>
                  ) : resolveError ? (
                    <span className="text-red-400/80">{resolveError}</span>
                  ) : (
                    <span className="text-white/25">Account name appears here once the number + bank are entered</span>
                  )}
                </div>
                <div className="flex gap-2 mt-2">
                  <button onClick={handleAddBank} disabled={addingBank || resolving || !accountName} className="flex-1 bg-white/10 hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs py-2 rounded-lg transition-all">{addingBank ? "Saving..." : "Save Bank"}</button>
                  {banks.length > 0 && <button onClick={() => setShowAddBank(false)} className="px-4 text-white/50 hover:text-white text-xs transition-colors">Cancel</button>}
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <div
                    className="w-full bg-white/5 backdrop-blur-md border border-white/10 rounded-xl px-4 py-3 text-white text-sm cursor-pointer hover:bg-white/10 transition-colors flex items-center justify-between shadow-lg"
                    onClick={() => setIsSavedBankDropdownOpen(!isSavedBankDropdownOpen)}
                  >
                    {selectedBankId ? (() => {
                      const sel = banks.find(b => b.id === selectedBankId);
                      return (
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="w-5 h-5 rounded-full bg-indigo-500/30 text-[10px] flex items-center justify-center font-bold text-indigo-200 shrink-0">{(sel?.bankName || "?").charAt(0)}</span>
                          <div className="flex flex-col min-w-0 leading-tight">
                            {sel?.accountName && <span className="font-medium truncate">{sel.accountName}</span>}
                            <span className={sel?.accountName ? "text-xs text-white/40" : "font-medium"}>{sel?.bankName} · {sel?.accountNumber}</span>
                          </div>
                        </div>
                      );
                    })() : (
                      <span className="text-white/50">Select Bank...</span>
                    )}
                    <svg className={`w-4 h-4 text-white/50 transition-transform duration-300 ${isSavedBankDropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </div>

                  <AnimatePresence>
                    {isSavedBankDropdownOpen && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                        className="w-full mt-2 bg-indigo-950/90 backdrop-blur-2xl border border-white/10 rounded-xl overflow-hidden max-h-60 overflow-y-auto custom-scrollbar"
                      >
                        {banks.map(b => {
                          return (
                            <div
                              key={b.id}
                              className="px-4 py-3 hover:bg-white/10 cursor-pointer flex items-center gap-3 transition-colors border-b border-white/5 last:border-0"
                              onClick={() => {
                                setSelectedBankId(b.id);
                                setIsSavedBankDropdownOpen(false);
                              }}
                            >
                              <span className="w-6 h-6 rounded-full bg-indigo-500/25 text-[11px] flex items-center justify-center font-bold text-indigo-200 shrink-0">{(b.bankName || "?").charAt(0)}</span>
                              <div className="flex flex-col min-w-0 leading-tight">
                                {b.accountName && <span className="text-sm text-white/90 font-medium truncate">{b.accountName}</span>}
                                <span className={b.accountName ? "text-xs text-white/40" : "text-sm text-white/90 font-medium"}>{b.bankName} · {b.accountNumber}</span>
                              </div>
                            </div>
                          );
                        })}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                <button onClick={() => setShowAddBank(true)} className="px-4 bg-white/5 backdrop-blur-md border border-white/10 rounded-xl hover:bg-white/10 text-white/60 hover:text-white transition-all text-xl shadow-lg" title="Add new bank">+</button>
              </div>
            )}
          </div>

          <ShieldedKeyGate />

          <button
            onClick={() => handleSwap()}
            disabled={swapping || !quote || !selectedBankId || quoteLoading || (session.onboarded && !session.wallet) || !session.identity}
            className="w-full font-semibold px-6 py-4 rounded-xl bg-white/10 backdrop-blur-md border border-white/20 hover:bg-white/20 hover:border-white/30 text-white shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {swapping ? "Executing Swap..." :
              (session.onboarded && !session.wallet) ? "Connecting Wallet..." :
                (quote?.requireBvn && !session.bvnVerified ? "Verify Identity to Swap" : "Swap Now")}
          </button>
        </motion.div>
      </div>

      {/* ── BVN Upgrade Modal ── */}
      <AnimatePresence>
        {showBvnModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <motion.div initial={{ scale: 0.95, y: 15 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 15 }} className="w-full max-w-sm bg-[#0d1117] border border-white/10 rounded-[2rem] p-8 shadow-2xl">
              <h3 className="geist-heading text-2xl mb-2 text-white font-medium">Identity Required</h3>
              <p className="text-white/60 text-sm mb-6">Large swaps require Tier 2 Identity. Please verify your BVN once to permanently unlock high limits.</p>
              <input type="text" maxLength={11} className="w-full bg-white/5 backdrop-blur-md border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:ring-2 focus:ring-indigo-500/50 mb-2 font-mono shadow-lg transition-all placeholder:text-white/20" placeholder="11-digit BVN" value={bvn} onChange={e => setBvn(e.target.value.replace(/\D/g, ""))} />
              {bvnError && <p className="text-red-400 text-xs mb-4">{bvnError}</p>}
              <div className="flex gap-3 mt-6">
                <button onClick={() => setShowBvnModal(false)} className="flex-1 py-3 border border-white/10 rounded-xl text-white/60 hover:text-white transition-all">Cancel</button>
                <button onClick={handleBvnUpgrade} disabled={verifyingBvn || bvn.length !== 11} className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl font-medium transition-all">{verifyingBvn ? "Verifying..." : "Verify BVN"}</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Cryptographic ZK Proof Modal ── */}
      <AnimatePresence>
        {proving && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4">
            <motion.div initial={{ scale: 0.95, y: 15 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 15 }} className="w-full max-w-md bg-[#0d1117] border border-white/10 rounded-[2rem] p-8 text-center relative overflow-hidden shadow-2xl">
              <div className="absolute inset-0 flex items-center justify-center opacity-5 pointer-events-none"><div className="w-64 h-64 border-2 border-dashed border-indigo-500 rounded-full animate-[spin_60s_linear_infinite]" /></div>
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 bg-indigo-500/20 rounded-full blur-[60px] pointer-events-none" />
              <div className="relative z-10">
                <div className="w-20 h-20 mx-auto mb-8 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center relative">
                  <div className="absolute inset-0 rounded-full border border-indigo-500/40 animate-ping opacity-25" />
                  <svg className="w-10 h-10 text-indigo-400 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                </div>
                <h3 className="geist-heading text-2xl mb-3 text-white font-medium">Zero-Knowledge Proof</h3>
                <p className="text-white/40 text-sm font-mono tracking-wider uppercase mb-8">{
                  swapProof.status === "fetching-path" ? "Fetching membership path"
                    : swapProof.status === "loading-circuit" ? "Loading circuit"
                      : "Generating proof in-browser"
                }</p>
                <p className="text-white/50 text-xs mt-6 leading-relaxed font-light">Your private credentials never leave your browser. A real ZK proof is generated locally to gate this action on-chain.</p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
