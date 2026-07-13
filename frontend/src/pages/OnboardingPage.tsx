import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { makeWallet } from "../lib/smartAccount";
import { humanizeError } from "@shieldpass/sdk/dist/errors";
import { deriveSeedFromPassword, deriveIdentityFromSeed, enrollPasskeyUnlock } from "../lib/shieldedKey";
import { unlockBankVault } from "../lib/bankVault";
import { loginWithGoogle } from "../lib/firebaseAuth";
import type { ShieldedIdentity } from "@shieldpass/sdk/dist/identity";

import { AnimatedLayout } from "../components/ui/animated-characters-login-page";

type Stage = "info" | "passkey" | "deploying" | "done" | "error";

const fadeUp = {
  hidden: { opacity: 0, y: 10, filter: "blur(4px)" },
  visible: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.4 } },
};

const inputCls =
  "w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all font-mono text-sm";
const btnPrimary =
  "w-full font-semibold px-6 py-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20 hover:scale-[1.01] active:scale-[0.99] transition-all cursor-pointer font-mono text-sm uppercase tracking-widest";
const btnDisabled =
  "w-full font-semibold px-6 py-4 rounded-xl bg-white/5 text-white/30 cursor-not-allowed font-mono text-sm uppercase tracking-widest";

export default function OnboardingPage() {
  const navigate = useNavigate();
  const session = useSession();

  const [stage, setStage] = useState<Stage>("info");
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [socialSub, setSocialSub] = useState<string | undefined>(undefined);
  const [socialVerified, setSocialVerified] = useState(false);
  const [socialBusy, setSocialBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Welcome-bonus state for the done card. 'settling' = the faucet is confirming on-chain in the
  // background and will appear in the shielded balance once it's real (hide-until-settled).
  const [welcomeBonus, setWelcomeBonus] = useState<'settling' | null>(null);

  // A social login (Firebase) just verifies an email; a manually-typed one still needs the
  // usual format check. Either way a PIN/password is still required next — it's the seed
  // material for the shielded identity (deriveSeedFromPassword), not just an auth factor.
  const pinValid = /^\d{4,6}$/.test(pin) || pin.length >= 8;
  const infoValid = (socialVerified || /\S+@\S+\.\S+/.test(email)) && pinValid;

  const [isTyping, setIsTyping] = useState(false);

  async function continueWithSocial() {
    setErrorMessage(null);
    setSocialBusy(true);
    try {
      const { email: verifiedEmail, providerSub } = await loginWithGoogle((idToken) => api.verifySession({ idToken }));
      setEmail(verifiedEmail);
      setSocialSub(providerSub);
      setSocialVerified(true);
    } catch (err) {
      setErrorMessage(humanizeError(err).title);
    } finally {
      setSocialBusy(false);
    }
  }

  async function createPasskey() {
    setErrorMessage(null);
    setStage("deploying");
    try {
      let check;
      try {
        check = await api.verifyPin({ email, pin });
      } catch (e: any) {
        if (e.message && e.message.includes("No user")) check = null;
        else throw e;
      }

      if (check && !check.ok) {
        throw new Error("Incorrect PIN for existing account.");
      }

      let wallet, credentialId, address, secretSalt, merkleRoot, bvnVerified = false;
      let pendingFaucet: import('../lib/session').Session['pendingFaucet'] = null;
      let identity: ShieldedIdentity;
      let shieldedSeed: Uint8Array | null = null;
      const toHex = (u8: Uint8Array) => Array.from(u8).map((b) => b.toString(16).padStart(2, '0')).join('');

      if (check?.ok && check.passkeyKeyId && check.smartWalletAddress) {
        // --- LOGIN FLOW ---
        wallet = await makeWallet();
        await wallet.connectWallet(check.passkeyKeyId, check.smartWalletAddress); // Prompts Face ID / Touch ID
        credentialId = check.passkeyKeyId;
        address = check.smartWalletAddress;
        // Re-derive shielded identity from PIN — no second passkey prompt.
        const seed = await deriveSeedFromPassword(pin, email);
        identity = deriveIdentityFromSeed(seed);
        shieldedSeed = seed;
        await unlockBankVault(seed, email);

        const reissue = await api.reissueSalt({ email, pin });
        secretSalt = reissue.secretSalt;
        merkleRoot = reissue.merkleRoot;
        bvnVerified = reissue.bvnVerified;
      } else {
        // --- SIGNUP FLOW ---
        // createWallet deploys the OZ smart account gaslessly via the relayer proxy (no manual submit).
        wallet = await makeWallet();
        const res = await wallet.createWallet("ShieldPass", email);
        credentialId = res.credentialId;
        address = res.contractId;
        // publish the shielded identity so others can send by email; faucet note is owned by us.
        // Derive shielded identity from PIN — one passkey prompt total (just createWallet above).
        const seed = await deriveSeedFromPassword(pin, email);
        identity = deriveIdentityFromSeed(seed);
        shieldedSeed = seed;
        await unlockBankVault(seed, email);

        const linkRes = await api.linkWallet({
          email, pin, smartWalletAddress: res.contractId, passkeyKeyId: res.credentialId,
          shieldedOwner: identity.owner.toString(), shieldedEncPub: toHex(identity.encPublic), shieldedAddress: identity.address,
          socialSub,
        });
        secretSalt = linkRes.secretSalt;
        merkleRoot = linkRes.merkleRoot;
        if (linkRes.faucetPending && linkRes.faucetSecret) {
          // The faucet settles on-chain in the BACKGROUND. Stash the secret; the app-level
          // usePendingFaucet hook polls until it's backed, then proves it in-browser and reveals
          // the 500 in the shielded balance (hide-until-settled). Nothing shows until it's real.
          pendingFaucet = {
            commitment: linkRes.faucetSecret.commitment,
            amount: linkRes.faucetSecret.amount,
            randomness: linkRes.faucetSecret.randomness,
            asset: linkRes.faucetSecret.asset,
            compliance: linkRes.faucetSecret.compliance,
          };
          setWelcomeBonus('settling');
        }
      }

      session.set({
        wallet, identity, shieldedAddress: identity.address,
        credentialId, address, email, secretSalt, merkleRoot, bvnVerified,
        pendingFaucet,
        // Do NOT wipe notes here: on login we keep any locally-persisted notes, and the note
        // scanner rebuilds the rest from the encrypted blob store. (Previously this set notes:[]
        // which scraped the shielded balance on every login.)
      });

      // Enroll biometric unlock for the shielded key (best-effort, one attempt per device). Wraps
      // the PIN-derived seed under the passkey PRF so future unlocks can use Face ID / fingerprint.
      // Self-guards + swallows errors: no-op if already enrolled or if the passkey lacks PRF.
      if (shieldedSeed) await enrollPasskeyUnlock(shieldedSeed, email, credentialId).catch(() => {});

      setStage("done");
    } catch (err) {
      setStage("error");
      setErrorMessage(humanizeError(err).title);
    }
  }

  // Google already verified identity, so once a valid PIN is typed there's nothing left to
  // confirm manually — go straight to the passkey prompt instead of making the user click
  // Continue then Secure Account. Debounced so a 4-digit PIN doesn't fire mid-typing if the
  // user meant to keep going to 5 or 6 digits.
  useEffect(() => {
    if (!socialVerified || !pinValid || stage !== "info") return;
    const timer = setTimeout(() => {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate debounced auto-advance, not a render-time side effect
      createPasskey();
    }, 600);
    return () => clearTimeout(timer);
    // createPasskey is intentionally omitted: it's recreated every render, and including it
    // would re-arm the timer on every keystroke render rather than just PIN/social changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socialVerified, pinValid, pin, stage]);

  return (
    <AnimatedLayout showPassword={false} passwordLength={pin.length} isTyping={isTyping}>
      <div className="relative w-full sm:w-[400px] mx-auto space-y-6">
        <button onClick={() => navigate("/")} className="absolute -top-16 -left-4 text-white/50 hover:text-white flex items-center transition-colors">
          <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          Home
        </button>
        
        <div className="lg:hidden mb-4">
          <span className="nav-logo">SHIELDPASS</span>
        </div>
        
        <motion.div initial="hidden" animate="visible" variants={{ visible: { transition: { staggerChildren: 0.1 } } }}>
          <motion.p variants={fadeUp} className="font-mono text-xs uppercase tracking-widest text-indigo-400 mb-4 font-semibold">
            Web2 Onboarding
          </motion.p>
          <motion.h1 variants={fadeUp} className="geist-heading text-3xl md:text-4xl mb-4 bg-gradient-to-r from-white via-white to-white/60 bg-clip-text text-transparent font-medium">
            {stage === "done" ? "You're live" : "Create your account"}
          </motion.h1>
          <motion.p variants={fadeUp} className="text-white/60 text-sm mb-10 leading-relaxed font-light">
            No seed phrases. Secure your account with Face ID / fingerprint. Your smart wallet deploys silently.
          </motion.p>

          {stage === "info" && (
            <motion.div variants={fadeUp} className="space-y-5 relative z-10">
              <button
                type="button"
                onClick={continueWithSocial}
                disabled={socialBusy || socialVerified}
                className={socialVerified ? btnDisabled : "w-full font-semibold px-6 py-4 rounded-xl bg-white/10 hover:bg-white/15 text-white border border-white/10 transition-all cursor-pointer font-mono text-sm"}
              >
                {socialVerified ? `Signed in as ${email}` : socialBusy ? "Opening login…" : "Continue with Google"}
              </button>

              {errorMessage && (
                <p className="text-sm text-red-400 font-medium">{errorMessage}</p>
              )}

              <div className="flex items-center gap-3 text-white/25 text-xs">
                <div className="h-px flex-1 bg-white/10" /> OR <div className="h-px flex-1 bg-white/10" />
              </div>

              <input
                className={inputCls}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onFocus={() => setIsTyping(true)}
                onBlur={() => setIsTyping(false)}
                placeholder="you@example.com"
                disabled={socialVerified}
              />
              <input
                className={inputCls}
                type="password"
                maxLength={64}
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                onFocus={() => setIsTyping(true)}
                onBlur={() => setIsTyping(false)}
                placeholder="4-6 digit PIN, or an 8+ character password"
              />
              <button className={infoValid ? btnPrimary : btnDisabled} disabled={!infoValid} onClick={() => (socialVerified ? createPasskey() : setStage("passkey"))}>Continue</button>
            </motion.div>
          )}

          {(stage === "passkey" || stage === "deploying") && (
            <motion.div variants={fadeUp} className="space-y-6 relative z-10">
              <p className="text-white/70 text-sm">Secure your account with Face ID / fingerprint. Your wallet deploys silently — gasless.</p>
              <p className="text-white/40 text-xs">No fingerprint or Face ID? Use your Windows Hello PIN, or scan the prompt's QR with your phone.</p>
              <button className={stage === "deploying" ? btnDisabled : btnPrimary} disabled={stage === "deploying"} onClick={createPasskey}>
                {stage === "deploying" ? "Authenticating…" : "Secure Account"}
              </button>
            </motion.div>
          )}

          {stage === "error" && (
            <motion.div variants={fadeUp} className="space-y-4 relative z-10">
              <p className="text-sm text-red-400 font-medium">{errorMessage}</p>
              <button className={btnPrimary} onClick={() => setStage("passkey")}>Try again</button>
            </motion.div>
          )}

          {stage === "done" && (
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5 }} className="border border-green-500/20 bg-green-500/[0.02] rounded-2xl p-6 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-green-500/10 rounded-full blur-2xl pointer-events-none" />
              <p className="text-green-400 text-sm font-semibold mb-6 flex items-center gap-3">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                </span>
                Account Secured
              </p>
              <dl className="space-y-4 font-mono text-xs text-white/70">
                <div>
                  <dt className="mb-2 text-white/40 uppercase tracking-wider text-[10px]">Smart wallet (passkey)</dt>
                  <dd className="break-all border border-white/5 bg-white/[0.01] p-3.5 rounded-lg text-white font-mono select-all">{session.address}</dd>
                </div>
                {welcomeBonus === 'settling' && (
                  <div>
                    <dt className="mb-2 text-white/40 uppercase tracking-wider text-[10px]">Welcome bonus</dt>
                    <dd className="border border-white/5 bg-white/[0.01] p-3.5 rounded-lg text-white/80">
                      100 XLM is confirming into your private shielded balance — it'll appear shortly.
                    </dd>
                  </div>
                )}
              </dl>
              <button onClick={() => navigate("/dashboard")} className="mt-8 w-full font-semibold px-6 py-4 rounded-xl bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white shadow-lg shadow-green-500/20 hover:scale-[1.01] active:scale-[0.99] transition-all cursor-pointer flex items-center justify-center gap-2">
                Go to Dashboard
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
              </button>
            </motion.div>
          )}
        </motion.div>
      </div>
    </AnimatedLayout>
  );
}
