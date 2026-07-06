import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { motion } from "motion/react";
import { Buffer } from "buffer";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import ShieldedKeyGate from "../components/ShieldedKeyGate";
import QrScanner from "../components/QrScanner";
import { useSwapProof } from "../lib/useSwapProof";
import { useShieldedTransfer } from "../lib/useShieldedTransfer";
import ErrorNotice from "../components/ErrorNotice";
import { assetByCode, formatUnits, parseUnits } from "../lib/assets";
import { useInsertProof } from "../lib/useInsertProof";
import { encryptNote } from "@shieldpass/sdk/dist/identity";
import { addressToField } from "@shieldpass/sdk/dist/stellar";
import { isAddr, isShp, isShieldPassUser, recipientFromScan } from "../lib/recipient";

const buf = (u8: Uint8Array): Buffer => Buffer.from(u8);

function randomField(): string {
  const bytes = new Uint8Array(31);
  crypto.getRandomValues(bytes);
  let hex = "0x";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return BigInt(hex).toString();
}

const fadeUp = {
  hidden: { opacity: 0, y: 24, filter: "blur(6px)" },
  visible: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as any } },
};

export default function SendPage() {
  const session = useSession();
  const swapProof = useSwapProof(import.meta.env.VITE_API_URL as string);
  const transfer = useShieldedTransfer(import.meta.env.VITE_API_URL as string);
  const { insertProof } = useInsertProof();

  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [assetCode, setAssetCode] = useState<string>("XLM");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [success, setSuccess] = useState<{ message: string; txHash?: string } | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [searchParams] = useSearchParams();

  // Deep link: a scanned "Receive privately" QR opens …/send?to=shp_… — prefill the recipient.
  useEffect(() => {
    const to = searchParams.get("to");
    if (to) setRecipient(to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shieldedAssets = Array.from(new Set(session.notes.map((n) => n.asset || "XLM")));

  // Keep the selected asset pinned to one the user actually holds shielded balance in.
  useEffect(() => {
    if (shieldedAssets.length > 0 && !shieldedAssets.includes(assetCode)) {
      setAssetCode(shieldedAssets[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.notes]);

  const selectedAsset = assetByCode(assetCode);
  const short = (value: string) => `${value.slice(0, 6)}...${value.slice(-4)}`;

  const shieldedTotal = session.notes
    .filter((n) => (n.asset || "XLM") === assetCode)
    .reduce((sum, n) => sum + BigInt(n.amount), 0n);
  const shieldedBalanceStr = formatUnits(shieldedTotal, selectedAsset?.decimals ?? 7, 4);

  async function sendShielded(to: string) {
    if (!selectedAsset) throw new Error("Asset not configured.");

    let amt: bigint;
    try {
      amt = parseUnits(amount, selectedAsset.decimals);
    } catch {
      throw new Error("Enter a valid amount.");
    }

    if (amt <= 0n) throw new Error("Amount must be greater than zero.");

    if (isShieldPassUser(to)) {
      setStatus("Sending privately...");
      const txHash = await transfer.send(to, amt, selectedAsset.code);
      if (!txHash) throw new Error(transfer.error || "Private transfer failed.");

      setSuccess({ message: `Privately sent ${formatUnits(amt, selectedAsset.decimals, 4)} ${selectedAsset.code} to ${isShp(to) ? short(to) : to}. It stays shielded.`, txHash: txHash ?? undefined });
      api.notify({ email: session.email, type: "SEND_SHIELDED", title: "Sent privately", amount: formatUnits(amt, selectedAsset.decimals, 4), asset: selectedAsset.code, txHash: txHash ?? undefined }).catch(() => {});
      return;
    }

    const note = session.notes.find((n) => n.asset === selectedAsset.code && BigInt(n.amount) >= amt);
    if (!note) throw new Error(`No single shielded ${selectedAsset.code} note covers this amount.`);

    // Bind the proof to the on-chain destination `to` so the relayer cannot redirect funds.
    const pr = await swapProof.generate(note, amt, { accountNumber: 0n, salt: BigInt(randomField()) }, false, addressToField(to));
    if (!pr) throw new Error(swapProof.error || "Proof generation failed.");

    setStatus("Approve the send on your device...");
    const unshieldSendRes = await session.wallet!.invoke(selectedAsset.poolContractId, "unshield", {
      proof_a: buf(pr.proof.a),
      proof_b: buf(pr.proof.b),
      proof_c: buf(pr.proof.c),
      public_signals: pr.publicSignals.map(buf),
      recipient: to,
    });

    setStatus("Updating your balance...");
    const changeCommitment = BigInt("0x" + Buffer.from(pr.publicSignals[1]).toString("hex")).toString();
    const { index } = await insertProof(changeCommitment, setStatus, selectedAsset.poolContractId);
    const changeNotes = BigInt(pr.changeNote.amount) > 0n ? [{
      amount: pr.changeNote.amount,
      asset: note.asset,
      randomness: pr.changeNote.randomness,
      leafIndex: index,
      compliance: note.compliance,
      confirmed: true, // insertProof above already landed the change leaf on-chain
    }] : [];

    session.set({ notes: [...session.notes.filter((n) => n !== note), ...changeNotes] });

    // Publish a SELF-addressed recovery blob for the change note so our shielded balance survives
    // logout / a new device (the note scanner rebuilds from these blobs). Without it, unshield
    // change notes live only in localStorage and vanish on session reset.
    if (BigInt(pr.changeNote.amount) > 0n && session.identity) {
      try {
        const plaintext = new TextEncoder().encode(JSON.stringify({
          amount: pr.changeNote.amount, randomness: pr.changeNote.randomness,
          compliance: note.compliance, asset: note.asset,
        }));
        const enc = encryptNote(session.identity.encPublic, plaintext);
        await api.postNoteBlob({
          commitment: changeCommitment,
          ephemeralPub: Buffer.from(enc.ephemeralPublic).toString("hex"),
          ciphertext: Buffer.from(enc.ciphertext).toString("hex"),
        });
      } catch (e) {
        console.warn("[unshield] change recovery blob publish failed:", e);
      }
    }

    setSuccess({ message: `Sent ${formatUnits(amt, selectedAsset.decimals, 4)} ${note.asset} to ${short(to)} (now public).`, txHash: unshieldSendRes.hash });
    api.notify({ email: session.email, type: "UNSHIELD", title: "Sent to wallet", amount: formatUnits(amt, selectedAsset.decimals, 4), asset: note.asset, txHash: unshieldSendRes.hash }).catch(() => {});
  }

  async function handleSend() {
    setError(null);
    setSuccess(null);

    if (!session.wallet || !session.address) {
      setError(new Error("Wallet not connected. Please log in again."));
      return;
    }

    const to = recipient.trim();
    if (!amount) {
      setError(new Error("Enter an amount."));
      return;
    }

    const validRecipient = isAddr(to) || isShieldPassUser(to);
    if (!validRecipient) {
      setError(new Error("Enter a Stellar address, an email, or a shp_ address."));
      return;
    }

    try {
      setBusy(true);
      await sendShielded(to);
      setAmount("");
      setRecipient("");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
      setStatus("");
    }
  }

  const proving = swapProof.status === "fetching-path" || swapProof.status === "loading-circuit" || swapProof.status === "generating";

  return (
    <motion.div className="flex flex-col items-center w-full pt-4 sm:pt-6 pb-20 relative z-10" initial="hidden" animate="visible">
      <div className="w-full max-w-xl">
        <motion.div variants={fadeUp} className="text-center mb-8">
          <h1 className="geist-heading text-3xl sm:text-4xl md:text-5xl bg-gradient-to-r from-white via-white to-white/50 bg-clip-text text-transparent font-medium">
            Send
          </h1>
          <p className="text-white/40 text-sm mt-2 font-light">
            Every send is private by default, from your shielded balance.
          </p>
        </motion.div>

        <div className="space-y-6">
            {error ? (
              <div className="border border-red-500/20 bg-red-500/[0.02] p-4 rounded-2xl">
                <ErrorNotice error={error} />
              </div>
            ) : null}

            {success ? (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="border border-emerald-500/20 bg-emerald-500/[0.03] p-4 rounded-2xl text-emerald-300 text-sm flex items-center gap-2"
              >
                <span>{success.message}</span>
                {success.txHash && (
                  <a href={`https://stellar.expert/explorer/testnet/tx/${success.txHash}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center text-emerald-400/70 hover:text-emerald-300 transition-colors text-xs font-mono shrink-0" title="View on Stellar Explorer">
                    ↗
                  </a>
                )}
              </motion.div>
            ) : null}

            <motion.div variants={fadeUp} className="bg-gradient-to-br from-blue-900/30 to-indigo-900/20 backdrop-blur-xl border border-blue-500/20 shadow-2xl rounded-3xl p-6 space-y-5 font-display text-blue-50">
              <div>
                <label className="text-white/40 text-xs font-mono tracking-wider uppercase">Asset</label>
                <select
                  value={assetCode}
                  onChange={(e) => setAssetCode(e.target.value)}
                  className="mt-2 w-full bg-white/[0.03] border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-indigo-500/40 transition-colors"
                >
                  {shieldedAssets.map((code) => (
                    <option key={code} value={code} className="bg-neutral-900">
                      {code}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-white/40 text-xs font-mono tracking-wider uppercase">Recipient address</label>
                <div className="relative mt-2">
                  <input
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    placeholder="email, shp_… (private) or G…/C… (public)"
                    className="w-full bg-white/[0.03] border border-white/10 rounded-xl px-4 py-3 text-white text-sm font-mono outline-none focus:border-indigo-500/40 transition-colors pr-11"
                  />
                  <button
                    type="button"
                    onClick={() => setScanOpen(true)}
                    title="Scan a ShieldPass QR"
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m4-8h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" /></svg>
                  </button>
                </div>
              </div>

              <div>
                <div className="flex items-baseline justify-between">
                  <label className="text-white/40 text-xs font-mono tracking-wider uppercase">Amount ({assetCode})</label>
                  <span className="text-[11px] text-white/35">
                    {`Shielded: ${shieldedBalanceStr} ${assetCode}`}
                  </span>
                </div>
                <input
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0"
                  className="mt-2 w-full bg-white/[0.03] border border-white/10 rounded-xl px-4 py-3 text-white text-lg outline-none focus:border-indigo-500/40 transition-colors"
                />
              </div>

              <div className="text-white/35 text-xs leading-relaxed border border-white/5 bg-white/[0.01] rounded-xl p-3">
                {isShieldPassUser(recipient.trim()) ? (
                  <>
                    <span className="text-emerald-300/80">Fully private.</span> Sending to a ShieldPass {isShp(recipient.trim()) ? "shp_ address" : "email"} — the recipient receives a <span className="text-white/70">shielded note</span>, private on both ends.
                  </>
                ) : (
                  <>
                    You spend a private note - <span className="text-white/70">nobody can trace which deposit it came from</span> - but sending to a plain wallet address <span className="text-amber-300/80">unshields it (the recipient gets public crypto)</span>. To keep it fully private, use their <span className="text-white/70">email or shp_ address</span>.
                  </>
                )}
              </div>

              <ShieldedKeyGate />

              <QrScanner
                open={scanOpen}
                onClose={() => setScanOpen(false)}
                onResult={(text) => {
                  setRecipient(recipientFromScan(text));
                  setScanOpen(false);
                }}
              />

              <button
                onClick={handleSend}
                disabled={busy || !amount || !recipient || (session.onboarded && !session.wallet) || !session.identity}
                className="w-full py-3.5 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {busy ? (proving ? "Generating proof..." : status || "Sending...") : "Send privately"}
              </button>
            </motion.div>
        </div>
      </div>
    </motion.div>
  );
}
