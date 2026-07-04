import ScrollHero from "../components/ui/ethereal";

import { Icons } from "../components/ui/icons";
import { motion, useInView } from "motion/react";
import { useRef, useState, useEffect } from "react";
import { Link } from "react-router-dom";

const btnPrimary =
  "font-mono text-[10px] sm:text-xs uppercase tracking-widest px-5 py-2.5 rounded-lg font-medium bg-indigo-600 text-white hover:bg-indigo-500 transition-colors";
const btnGhost =
  "inline-flex items-center gap-2 font-mono text-[10px] sm:text-xs uppercase tracking-widest px-5 py-2.5 rounded-lg font-medium border border-white/15 text-white/80 hover:bg-white/5 transition-colors";

function AnimatedLock() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });
  const [locked, setLocked] = useState(false);
  
  useEffect(() => {
    if (isInView) {
      const timeout = setTimeout(() => {
        setLocked(true);
      }, 600);
      return () => clearTimeout(timeout);
    }
  }, [isInView]);

  return (
    <div ref={ref} className="text-3xl mb-1 h-[36px]">
      {locked ? "🔒" : "🔓"}
    </div>
  );
}

function RevealText({ text }: { text: string }) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: false, margin: "-100px" });

  return (
    <motion.span
      ref={ref}
      initial={{ opacity: 0, y: 30, filter: "blur(8px)" }}
      animate={isInView ? { opacity: 1, y: 0, filter: "blur(0px)" } : { opacity: 0, y: 30, filter: "blur(8px)" }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
      className="inline-block"
    >
      {text}
    </motion.span>
  );
}

function SlowFadeText({ text }: { text: string }) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: false, margin: "-100px" });

  return (
    <motion.span
      ref={ref}
      initial={{ opacity: 0 }}
      animate={isInView ? { opacity: 1 } : { opacity: 0 }}
      transition={{ duration: 2, ease: "easeInOut", delay: 0.2 }}
      className="inline-block"
    >
      {text}&nbsp;
    </motion.span>
  );
}

function TypewriterText({ text, delayStart = 0.4 }: { text: string; delayStart?: number }) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: false, margin: "-100px" });

  return (
    <span ref={ref}>
      {text.split("").map((char, index) => (
        <motion.span
          key={index}
          initial={{ opacity: 0 }}
          animate={isInView ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 0.05, delay: delayStart + index * 0.02 }}
        >
          {char}
        </motion.span>
      ))}
    </span>
  );
}

/* ── Presentational helpers for the right-column media panels ── */

function Panel({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div className="w-full p-6 sm:p-8 flex flex-col gap-3 justify-center">
      {label && (
        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/40 mb-1">{label}</div>
      )}
      {children}
    </div>
  );
}

function Feature({ label, index = 0 }: { label: string, index?: number }) {
  return (
    <div className="flex items-center gap-3">
      <motion.span 
        animate={{ 
          scale: [0, 1.2, 1, 1], 
          opacity: [0, 1, 1, 1] 
        }}
        transition={{ 
          duration: 3, 
          repeat: Infinity, 
          delay: index * 0.2,
          times: [0, 0.1, 0.15, 1],
          ease: "easeOut"
        }}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#06ffa5]/10 text-[#06ffa5] text-xs"
      >
        ✓
      </motion.span>
      <motion.span 
        animate={{ 
          y: [10, 0, 0],
          opacity: [0, 1, 1] 
        }}
        transition={{ 
          duration: 3, 
          repeat: Infinity, 
          delay: index * 0.2,
          times: [0, 0.15, 1],
          ease: "easeOut"
        }}
        className="text-white/70 text-sm font-light"
      >
        {label}
      </motion.span>
    </div>
  );
}

function Asset({ sym, name, index = 0, className }: { sym: string; name: string; index?: number; className?: string }) {
  return (
    <motion.div 
      animate={{ opacity: [0, 1, 1, 1, 0] }}
      transition={{ 
        duration: 5, 
        repeat: Infinity, 
        delay: index * 0.6,
        times: [0, 0.15, 0.2, 0.85, 1],
        ease: "easeInOut"
      }}
      className={`flex items-center justify-between rounded-xl border px-4 py-3 ${className || "border-white/10 bg-white/[0.03]"}`}
    >
      <span className="font-mono text-white text-sm">{sym}</span>
      <span className="text-white/40 text-xs font-light">{name}</span>
    </motion.div>
  );
}

function Faq({ q, a, index = 0 }: { q: string; a: string; index?: number }) {
  return (
    <motion.div 
      animate={{ opacity: [0, 1, 1, 1, 0] }}
      transition={{ 
        duration: 5, 
        repeat: Infinity, 
        delay: index * 0.6,
        times: [0, 0.15, 0.2, 0.85, 1],
        ease: "easeInOut"
      }}
      className="rounded-xl border border-white/10 bg-white/[0.03] px-5 py-4"
    >
      <p className="text-white/90 text-sm font-medium mb-1.5">{q}</p>
      <p className="text-white/50 text-xs font-light leading-relaxed">{a}</p>
    </motion.div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 font-mono text-[9px] sm:text-[10px] uppercase tracking-[0.15em] text-white/55">
      {children}
    </span>
  );
}

export default function LandingPage() {
  return (
    <ScrollHero
      sections={[
        {
          id: "hero",
          headline: "ShieldPass",
          subheadline: <RevealText text="Private Swaps & Payments" />,
          body: <TypewriterText text="Swap crypto for naira and send funds privately — with zero identity exposure. Every proof is verified on-chain on Stellar." />,
          action: (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-3">
                {/* Single entry point: /onboarding handles BOTH sign-up (new email) and
                    login (existing email + PIN), deriving the same PIN-based shielded
                    identity either way. A separate login path that derived the identity
                    differently was removed — it would have handed returning users the
                    wrong shielded key and hidden their balance. */}
                <Link to="/onboarding" className={btnPrimary}>Log in / Sign up</Link>
              </div>
              <div className="flex flex-wrap gap-2">
                <Pill>Stellar Testnet</Pill>
                <Pill>On-chain ZK</Pill>
                <Pill>Gasless</Pill>
                <Pill>No Seed Phrase</Pill>
              </div>
            </div>
          ),
          media: (
            <Panel label="Zero-knowledge proof">
              <Feature label="Passkey · attested" index={0} />
              <Feature label="Good standing · verified" index={1} />
              <Feature label="BVN · large swaps only" index={2} />
              <div className="mt-3 rounded-lg bg-black/40 border border-white/10 px-4 py-3 font-mono text-[11px] text-[#06ffa5] break-all">
                nullifier 0x9f2c…a41e
              </div>
              <p className="text-white/30 text-[10px] font-mono">your identity never leaves this device</p>
            </Panel>
          ),
        },
        {
          id: "privacy",
          headline: "Private",
          subheadline: <RevealText text="By Default" />,
          body: (
            <span>
              <SlowFadeText text="Your identity and" />
              <TypewriterText
                text="personal data never leave your device. Only cryptographic proofs travel on-chain."
                delayStart={1.5}
              />
            </span>
          ),
          media: (
            <Panel label="Where your data lives">
              <div className="rounded-xl border border-[#06ffa5]/20 bg-[#06ffa5]/[0.04] px-4 py-3">
                <p className="text-[#06ffa5] text-[11px] font-mono mb-1">ON YOUR DEVICE</p>
                <p className="text-white/60 text-xs font-light">identity · BVN · bank details · secret salt</p>
              </div>
              <div className="text-center text-white/30 text-xs">↓ only a proof crosses ↓</div>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                <p className="text-white/70 text-[11px] font-mono mb-1">ON-CHAIN</p>
                <p className="text-white/40 text-xs font-light">zk proof · time-bound nullifier</p>
              </div>
            </Panel>
          ),
        },
        {
          id: "passkeys",
          headline: "Passkeys",
          subheadline: "No Seed Phrase, No Gas",
          body: <TypewriterText text="Your wallet is a passkey — unlock it with Face ID, a fingerprint, or your device PIN. Your private spending key is derived from it, so resetting your PIN never risks your funds. Every transaction is sponsored." delayStart={0.2} />,
          media: (
            <Panel label="Sign in with">
              <Feature label="Face ID" index={0} />
              <Feature label="Fingerprint" index={1} />
              <Feature label="Device PIN (Windows Hello)" index={2} />
              <Feature label="Your phone — scan the QR" index={3} />
              <div className="mt-3 rounded-lg border border-[#06ffa5]/20 bg-[#06ffa5]/[0.04] px-4 py-3">
                <p className="text-white/70 text-xs font-light">Your <span className="text-[#06ffa5] font-mono">shielded key</span> is derived from your passkey</p>
              </div>
              <div className="mt-2 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3">
                <p className="text-white/70 text-xs font-light">
                  <span className="text-[#06ffa5] font-mono">0 XLM</span> needed — fees sponsored via OpenZeppelin Channels
                </p>
              </div>
            </Panel>
          ),
        },
        {
          id: "shielded-pool",
          headline: "Shielded",
          subheadline: <RevealText text="Pool" />,
          body: "Your balance isn't a public escrow — it's a secret note inside a shared pool, owned by your shielded key. Everyone's funds mix together, so no one watching the chain can tell which note is yours.",
          media: (
            <Panel label="Your money, hidden in a crowd">
              <Feature label="Funds held as secret notes" index={0} />
              <Feature label="All balances mixed in one pool" index={1} />
              <Feature label="Unlinkable — no one sees which is yours" index={2} />
              <Feature label="Spend only with your shielded key" index={3} />
            </Panel>
          ),
        },
        {
          id: "onchain-zk",
          headline: "Verified",
          subheadline: "On-Chain",
          body: "No trusted verifier. The Soroban smart contract checks every zero-knowledge proof itself, on-chain, using Stellar's native BN254 pairing functions. The math is the only authority.",
          media: (
            <Panel label="Trust the math, not the server">
              <Feature label="Groth16 proofs verified on-chain" index={0} />
              <Feature label="Native bn254 pairing-check" index={1} />
              <Feature label="No off-chain verifier to trust" index={2} />
              <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3">
                <p className="text-white/70 text-xs font-light"><span className="text-[#06ffa5] font-mono">~37.5M</span> instructions per verify — well within budget</p>
              </div>
            </Panel>
          ),
        },
        {
          id: "private-payments",
          headline: "Private",
          subheadline: <RevealText text="Payments" />,
          body: "Send funds to another ShieldPass user by email or shielded address. The money never leaves the pool — your note is spent, theirs is created — and the amount, sender, and receiver all stay hidden.",
          media: (
            <Panel label="Send like a locked, nameless envelope">
              <Feature label="Amount hidden" index={0} />
              <Feature label="Sender & receiver hidden" index={1} />
              <Feature label="Delivered via an encrypted note" index={2} />
              <Feature label="Recipient's balance just goes up" index={3} />
            </Panel>
          ),
        },
        {
          id: "refund",
          headline: "Trustless",
          subheadline: "Refund",
          body: "Cashing out? Your crypto is committed with a refund note before any fiat moves. If the naira payout ever fails, you reclaim your value automatically after a 1-hour time-lock. The platform can never simply keep your crypto.",
          media: (
            <Panel label="Math-enforced safety net">
              <Feature label="Refund note pre-committed on-chain" index={0} />
              <Feature label="Auto-reclaim after 1 hour if fiat fails" index={1} />
              <Feature label="No middleman can freeze your funds" index={2} />
              <Feature label="Your keys never leave your device" index={3} />
            </Panel>
          ),
        },
        {
          id: "assets",
          headline: "Assets",
          subheadline: <RevealText text="Crypto ⇄ Naira" />,
          body: "Trade between Stellar-native assets and Nigerian naira. Fiat moves through Lenco Business Banking while crypto settles on-chain.",
          media: (
            <Panel label="Supported assets">
              <Asset sym="XLM" name="Stellar Lumens" index={0} />
              <Asset sym="USDC" name="USD Coin" index={1} />
              <Asset sym="NGNC" name="Naira stablecoin" index={2} />
              <Asset sym="₦ NGN" name="via Lenco" index={3} className="mt-1 border-indigo-500/20 bg-indigo-500/[0.06]" />
            </Panel>
          ),
        },
        {
          id: "trade",
          headline: "Trade",
          subheadline: "Freely",
          body: "Instant crypto/naira exchange with the safety of KYC but none of the exposure.",
        },
        {
          id: "how-it-works-intro",
          headline: "How It Works",
          subheadline: <RevealText text="The Protocol" />,
          body: <TypewriterText text="A seamless 3-step process to trade securely without exposing your identity." />,
        },
        {
          id: "how-it-works-1",
          headline: "Step 1",
          subheadline: "Create & Verify",
          body: "Create a passkey wallet with Face ID, fingerprint, or your device PIN, and generate a Zero-Knowledge proof of your identity. Your actual data never leaves your device.",
          media: (
            <Panel label="Step 1 · Verify">
              <Feature label="Create passkey wallet" index={0} />
              <Feature label="Generate ZK identity proof" index={1} />
              <div className="mt-2 h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                <motion.div 
                  className="h-full bg-[#06ffa5]/70 rounded-full" 
                  animate={{ width: ["0%", "100%", "100%"] }}
                  transition={{ 
                    duration: 2.5, 
                    repeat: Infinity, 
                    times: [0, 0.8, 1],
                    ease: "easeInOut" 
                  }}
                />
              </div>
              <p className="text-white/30 text-[10px] font-mono">proving… data stays local</p>
            </Panel>
          ),
        },
        {
          id: "how-it-works-2",
          headline: "Step 2",
          subheadline: "Prove & Spend",
          body: "To swap or send, your phone generates a zero-knowledge proof that spends your secret note. The smart contract verifies it on-chain — no trusted server, and amounts stay hidden inside the pool.",
          media: (
            <Panel label="Step 2 · Prove">
              <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-5 text-center">
                <AnimatedLock />
                <p className="text-white/70 text-xs font-light">Proof verified on-chain</p>
              </div>
              <Feature label="Funds stay in the shielded pool" index={0} />
            </Panel>
          ),
        },
        {
          id: "how-it-works-3",
          headline: "Step 3",
          subheadline: "Settle or Send",
          body: "Cash out to naira — paid straight to your bank — or send privately to another user. Your change stays shielded, and a refund time-lock protects every withdrawal.",
          media: (
            <Panel label="Step 3 · Done">
              <Feature label="Naira payout to your bank" index={0} />
              <Feature label="…or a fully private transfer" index={1} />
              <div className="mt-2 rounded-lg border border-[#06ffa5]/20 bg-[#06ffa5]/[0.05] px-4 py-3 text-center">
                <span className="text-[#06ffa5] text-sm font-mono">✓ DONE — PRIVATELY</span>
              </div>
            </Panel>
          ),
        },
        {
          id: "faq",
          headline: "FAQ",
          subheadline: <RevealText text="Good to Know" />,
          body: "The questions every Swap user asks — answered up front.",
          media: (
            <div className="w-full p-5 sm:p-6 flex flex-col gap-3 justify-center">
              <Faq q="Can people see my balance or payments?" a="No. Balances are secret notes in a shielded pool, and private transfers hide the amount, sender, and receiver. Only zero-knowledge proofs ever go on-chain." index={0} />
              <Faq q="Who verifies the proofs?" a="The smart contract itself, on-chain, using Stellar's native BN254 pairing functions. There is no trusted off-chain verifier to rely on." index={1} />
              <Faq q="What if the fiat doesn't arrive?" a="Each withdrawal pre-commits a refund note. If the bank transfer fails, you reclaim your crypto automatically after a 1-hour time-lock." index={2} />
              <Faq q="I lost my device — can I recover?" a="Your passkey is device-bound; add a backup signer so a lost device doesn't mean lost funds." index={3} />
              <Faq q="What does it cost?" a="Transactions are gasless — fees are sponsored, so you don't need any XLM to start on testnet." index={4} />
            </div>
          ),
        },
        {
          id: "cta",
          headline: "Start Trading",
          subheadline: <RevealText text="Privately" />,
          body: "Create a passkey, prove your identity with zero knowledge, and trade in minutes.",
          action: (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-3">
                <Link to="/onboarding" className={btnPrimary}>Get Started</Link>
                <a
                  href="https://github.com/Xyrelix/ShieldPass"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={btnGhost}
                >
                  <Icons.gitHub className="h-4 w-4" /> GitHub
                </a>
              </div>
              <p className="text-white/35 text-xs font-light">
                Running on Stellar Testnet · Built for the Stellar Hacks: ZK hackathon.
              </p>
            </div>
          ),
        },
      ]}
      colorPalette={{
        primary: "#6366f1",
        secondary: "#8b5cf6",
        tertiary: "#ec4899",
        accent: "#06ffa5",
        dark: "#0a0a0a",
      }}
      logo="SHIELDPASS"
      menuItems={["Swap", "Dashboard", "Onboarding", "About", "Docs"]}
    />
  );
}
