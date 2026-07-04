import { useState } from "react";
import { useNavigate } from "react-router-dom";
import ShieldedKeyGate from "../components/ShieldedKeyGate";
import { motion } from "motion/react";
import { Buffer } from "buffer";
import { fieldToBytes32 } from "@shieldpass/sdk/dist/groth16Prover";
import { noteCommitment, type Compliance } from "@shieldpass/sdk/dist/notes";
import { encryptNote } from "@shieldpass/sdk/dist/identity";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { useSwapProof } from "../lib/useSwapProof";
import { useInsertProof } from "../lib/useInsertProof";
import ShieldedBalance from "../components/ShieldedBalance";
import ErrorNotice from "../components/ErrorNotice";
import { SUPPORTED_ASSETS, assetByCode, formatUnits, parseUnits } from "../lib/assets";
import { useWalletBalance } from "../lib/useWalletBalance";
import { addressToField } from "@shieldpass/sdk/dist/stellar";

const buf = (u8: Uint8Array): Buffer => Buffer.from(u8);

function randomField(): string {
  const a = new Uint8Array(31);
  crypto.getRandomValues(a);
  let h = "0x";
  for (const b of a) h += b.toString(16).padStart(2, "0");
  return BigInt(h).toString();
}

const fadeUp = {
  hidden: { opacity: 0, y: 24, filter: "blur(6px)" },
  visible: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as any } },
};

type Mode = "shield" | "unshield";

export default function DepositPage() {
  const navigate = useNavigate();
  const session = useSession();
  const swapProof = useSwapProof(import.meta.env.VITE_API_URL as string);
  const { insertProof } = useInsertProof();

  const [mode, setMode] = useState<Mode>("shield");
  const [assetCode, setAssetCode] = useState<string>(SUPPORTED_ASSETS[0]?.code ?? "XLM");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [success, setSuccess] = useState<{ message: string; txHash?: string } | null>(null);

  const shieldedAssets = Array.from(new Set(session.notes.map((n) => n.asset || "XLM")));
  const selectedAsset = assetByCode(assetCode) ?? SUPPORTED_ASSETS[0];

  const { balance: walletBalance, loading: walletLoading } = useWalletBalance(
    mode === "shield" ? assetCode : "",
    session.address,
  );
  const shieldedTotal = session.notes
    .filter((n) => (n.asset || "XLM") === assetCode)
    .reduce((sum, n) => sum + BigInt(n.amount), 0n);
  const shieldedBalanceStr = formatUnits(shieldedTotal, selectedAsset?.decimals ?? 7, 4);

  function switchMode(next: Mode) {
    if (busy) return;
    setMode(next);
    if (next === "unshield" && shieldedAssets.length > 0) setAssetCode(shieldedAssets[0]);
    if (next === "shield" && SUPPORTED_ASSETS.length > 0) setAssetCode(SUPPORTED_ASSETS[0].code);
    setError(null); setSuccess(null); setAmount("");
  }

  // ── Shield: wallet -> private pool ──
  async function handleShield(amt: bigint) {
    if (!selectedAsset) throw new Error("Asset is not configured.");
    if (!session.identity) throw new Error("Shielded key locked — unlock it to shield funds.");
    const compliance: Compliance = {
      hardware_attested: 1n,
      bvn_verified: session.bvnVerified ? 1n : 0n,
      good_standing: 1n,
    };
    const randomness = randomField();
    // Note is owned by the user's shielded key (so only they can later spend it).
    const commitment = noteCommitment(amt, session.identity.owner, BigInt(randomness), compliance);

    setStatus("Approve the shielding on your device…");
    const depositRes = await session.wallet!.invoke(selectedAsset.poolContractId, "deposit", {
      user: session.address,
      amount: amt,
      note_commitment: buf(fieldToBytes32(commitment)),
    });

    // Deposit confirmed on-chain. Run the merkle_insert proof in the browser:
    // assign index → prove in Web Worker → submit to backend → confirm on-chain.
    // Pool-scoped so the leaf lands in THIS asset's tree.
    const { index: leafIndex } = await insertProof(commitment.toString(), setStatus, selectedAsset.poolContractId);

    const noteCompliance = { hardware_attested: "1", bvn_verified: session.bvnVerified ? "1" : "0", good_standing: "1" };
    session.set({
      notes: [...session.notes, {
        amount: amt.toString(), asset: selectedAsset.code, randomness, leafIndex,
        compliance: noteCompliance,
        confirmed: true, // insertProof above already landed this leaf on-chain
      }],
    });

    // Publish a SELF-addressed recovery blob so this shielded note survives logout / a new device.
    // Without it, shield-deposit notes live only in localStorage and are lost when the session
    // resets (the note scanner rebuilds the balance by trial-decrypting these blobs).
    try {
      const plaintext = new TextEncoder().encode(JSON.stringify({
        amount: amt.toString(), randomness, compliance: noteCompliance, asset: selectedAsset.code,
      }));
      const enc = encryptNote(session.identity.encPublic, plaintext);
      await api.postNoteBlob({
        commitment: commitment.toString(),
        ephemeralPub: Buffer.from(enc.ephemeralPublic).toString("hex"),
        ciphertext: Buffer.from(enc.ciphertext).toString("hex"),
      });
    } catch (e) {
      console.warn("[shield] recovery blob publish failed (note still usable this session):", e);
    }

    setSuccess({ message: `Shielded ${formatUnits(amt, selectedAsset.decimals, 4)} ${selectedAsset.code} into your private balance.`, txHash: depositRes.hash });
    api.notify({ email: session.email, type: "SHIELD", title: "Shielded funds", amount: formatUnits(amt, selectedAsset.decimals, 4), asset: selectedAsset.code, txHash: depositRes.hash }).catch(() => {});
  }

  // ── Unshield: private pool -> wallet ──
  async function handleUnshield(amt: bigint) {
    if (!selectedAsset) throw new Error("Asset is not configured.");
    const note = session.notes.find((n) => n.asset === selectedAsset.code && BigInt(n.amount) >= amt);
    if (!note) throw new Error(`No single shielded ${selectedAsset.code} note covers this amount. Try a smaller amount.`);

    // Bind the proof to the on-chain recipient (the user's own wallet) so the relayer
    // cannot redirect the unshielded crypto elsewhere.
    const pr = await swapProof.generate(note, amt, { accountNumber: 0n, salt: BigInt(randomField()) }, false, addressToField(session.address!));
    if (!pr) throw new Error(swapProof.error || "Proof generation failed.");

    setStatus("Approve the unshield on your device…");
    const unshieldRes = await session.wallet!.invoke(selectedAsset.poolContractId, "unshield", {
      proof_a: buf(pr.proof.a),
      proof_b: buf(pr.proof.b),
      proof_c: buf(pr.proof.c),
      public_signals: pr.publicSignals.map(buf),
      recipient: session.address,
    });

    setStatus("Updating your balance…");
    const changeCommitment = BigInt("0x" + Buffer.from(pr.publicSignals[1]).toString("hex")).toString();
    const { index } = await insertProof(changeCommitment, setStatus, selectedAsset.poolContractId);
    const changeNotes = BigInt(pr.changeNote.amount) > 0n ? [{
      amount: pr.changeNote.amount, asset: note.asset, randomness: pr.changeNote.randomness,
      leafIndex: index, compliance: note.compliance,
      confirmed: true, // insertProof above already landed the change leaf on-chain
    }] : [];
    session.set({ notes: [...session.notes.filter((n) => n !== note), ...changeNotes] });
    setSuccess({ message: `Unshielded ${formatUnits(amt, selectedAsset.decimals, 4)} ${note.asset} back to your wallet.`, txHash: unshieldRes.hash });
    api.notify({ email: session.email, type: "UNSHIELD", title: "Unshielded to wallet", amount: formatUnits(amt, selectedAsset.decimals, 4), asset: note.asset, txHash: unshieldRes.hash }).catch(() => {});
  }

  async function handleSubmit() {
    setError(null); setSuccess(null);
    if (!selectedAsset) { setError(new Error("Missing asset contract config.")); return; }
    if (!session.wallet || !session.address) { setError(new Error("Wallet not connected. Please log in again.")); return; }
    let amt: bigint;
    try { amt = parseUnits(amount, selectedAsset.decimals); } catch (err) { setError(err); return; }
    if (amt <= 0n) { setError(new Error("Amount must be greater than zero.")); return; }

    try {
      setBusy(true);
      if (mode === "shield") await handleShield(amt);
      else await handleUnshield(amt);
      setAmount("");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
      setStatus("");
    }
  }

  const proving = swapProof.status === "fetching-path" || swapProof.status === "loading-circuit" || swapProof.status === "generating";
  const isShield = mode === "shield";

  return (
    <motion.div className="flex flex-col items-center w-full pt-4 sm:pt-6 pb-20 relative z-10" initial="hidden" animate="visible">
      <div className="w-full max-w-lg">
        <motion.div variants={fadeUp} className="text-center mb-8">
          <h1 className="geist-heading text-3xl sm:text-4xl md:text-5xl bg-gradient-to-r from-white via-white to-white/50 bg-clip-text text-transparent font-medium">
            {isShield ? "Shield" : "Unshield"}
          </h1>
          <p className="text-white/40 text-sm mt-2 font-light">
            {isShield
              ? "Move funds from your wallet into your private shielded balance."
              : "Move funds from your private balance back into your wallet as crypto."}
          </p>
        </motion.div>

        <motion.div variants={fadeUp} className="mb-6">
          <ShieldedBalance />
        </motion.div>

        {/* Direction toggle */}
        <motion.div variants={fadeUp} className="flex p-1 mb-6 rounded-xl border border-white/10 bg-white/[0.02]">
          {(["shield", "unshield"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => switchMode(m)}
              className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                mode === m ? "bg-indigo-600 text-white" : "text-white/50 hover:text-white/80"
              }`}
            >
              {m === "shield" ? "Shield" : "Unshield"}
            </button>
          ))}
        </motion.div>

        {error ? <div className="border border-red-500/20 bg-red-500/[0.02] p-4 rounded-2xl mb-6"><ErrorNotice error={error} /></div> : null}

        {success ? (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            className="border border-emerald-500/20 bg-emerald-500/[0.03] p-4 rounded-2xl mb-6 text-emerald-300 text-sm">
            <span>{success.message}</span>
            {success.txHash && (
              <a href={`https://stellar.expert/explorer/testnet/tx/${success.txHash}`} target="_blank" rel="noopener noreferrer" className="ml-2 inline-flex items-center gap-0.5 text-emerald-400/70 hover:text-emerald-300 transition-colors text-xs font-mono" title="View on Stellar Explorer">
                ↗
              </a>
            )}
            <button onClick={() => navigate(isShield ? "/withdraw" : "/dashboard")} className="ml-3 underline underline-offset-2 text-emerald-200">
              {isShield ? "Withdraw now →" : "View balance →"}
            </button>
          </motion.div>
        ) : null}

        <motion.div variants={fadeUp} className="bg-gradient-to-br from-blue-900/30 to-indigo-900/20 backdrop-blur-xl border border-blue-500/20 shadow-2xl rounded-3xl p-6 space-y-5 font-display text-blue-50">
          <div>
            <label className="text-white/40 text-xs font-mono tracking-wider uppercase">Asset</label>
            <select
              value={assetCode}
              onChange={(e) => setAssetCode(e.target.value as "XLM" | "USDC")}
              className="mt-2 w-full bg-white/[0.03] border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-indigo-500/40 transition-colors"
            >
              {(isShield ? SUPPORTED_ASSETS.map((a) => a.code) : shieldedAssets).map((code) => (
                <option key={code} value={code} className="bg-neutral-900">{code}</option>
              ))}
            </select>
          </div>

          <div>
            <div className="flex items-baseline justify-between">
              <label className="text-white/40 text-xs font-mono tracking-wider uppercase">
                Amount ({selectedAsset?.code ?? assetCode})
              </label>
              <span className="text-[11px] text-white/35">
                {isShield
                  ? walletLoading
                    ? "Loading balance…"
                    : walletBalance != null
                    ? `Wallet: ${walletBalance} ${assetCode}`
                    : null
                  : `Shielded: ${shieldedBalanceStr} ${assetCode}`}
              </span>
            </div>
            <input
              type="number" min="0" inputMode="decimal" value={amount}
              onChange={(e) => setAmount(e.target.value)} placeholder="0"
              className="mt-2 w-full bg-white/[0.03] border border-white/10 rounded-xl px-4 py-3 text-white text-lg outline-none focus:border-indigo-500/40 transition-colors"
            />
          </div>

          <div className="text-white/35 text-xs leading-relaxed border border-white/5 bg-white/[0.01] rounded-xl p-3">
            <p className="text-white/50 mb-1">How this works</p>
            {isShield
              ? <>You need the pool token in your wallet. The shielding transfer is <span className="text-white/70">public on-chain</span> — but once it's a shielded note, every withdrawal from it is <span className="text-white/70">private and unlinkable</span>.</>
              : <>A zero-knowledge proof is generated in your browser, then the pool sends the crypto to your smart wallet. The note you spend stays private.</>}
          </div>

          <ShieldedKeyGate />

          <button
            onClick={handleSubmit}
            disabled={busy || !amount || (session.onboarded && !session.wallet) || !session.identity}
            className="w-full py-3.5 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {busy
              ? (proving ? "Generating proof…" : status || (isShield ? "Shielding…" : "Unshielding…"))
              : (isShield ? "Shield funds" : "Unshield to wallet")}
          </button>
        </motion.div>
      </div>
    </motion.div>
  );
}
