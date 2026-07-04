import { motion } from "motion/react";

export default function AboutPage() {
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.15 } }
  };

  const itemVariants: any = {
    hidden: { opacity: 0, y: 12 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" } }
  };

  const sections = [
    {
      id: "privacy",
      headline: "Local Verification",
      subheadline: "Zero-Knowledge Privacy",
      body: "We utilize advanced ZK-proofs to verify your identity, such as your BVN, entirely locally. Your actual data never leaves your device. Only cryptographic, time-bound nullifier proofs are broadcasted and settled on the network, guaranteeing absolute privacy.",
      icon: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/svg/1f6e1.svg",
    },
    {
      id: "passkey",
      headline: "Seamless Auth",
      subheadline: "Passkey Wallets",
      body: "No seed phrases, no complicated setups. ShieldPass turns your device into a hardware wallet using Passkeys. You can sign transactions effortlessly using Face ID, Fingerprint, or your device PIN.",
      icon: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/svg/1f511.svg",
    },
    {
      id: "escrow",
      headline: "Smart Contracts",
      subheadline: "Trustless Escrow",
      body: "When initiating a trade, your crypto is securely locked in a decentralized smart contract. Assets are only released when fiat payment (like Naira) is confirmed, meaning no middleman can freeze or access your funds.",
      icon: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/svg/1f512.svg",
    },
    {
      id: "stellar",
      headline: "Gasless Network",
      subheadline: "Built on Stellar",
      body: "ShieldPass leverages the high speed and low latency of the Stellar network. Plus, every transaction is fully sponsored via OpenZeppelin Channels, meaning you never need native XLM to begin trading.",
      icon: "https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/svg/color/xlm.svg",
    }
  ];

  return (
    <div className="flex flex-col items-center justify-start min-h-[80vh] px-4 sm:px-6 relative z-10 pt-16 pb-20 w-full max-w-6xl mx-auto">
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="w-full flex flex-col"
      >
        <motion.div variants={itemVariants} className="text-center mb-24">
          <h1 className="text-4xl md:text-6xl font-bold text-white mb-6 font-display">
            About ShieldPass
          </h1>
          <p className="text-lg md:text-xl text-white/70 max-w-3xl mx-auto font-light leading-relaxed">
            ShieldPass is a zero-knowledge P2P trading platform built on the Stellar network.
            We believe that you should be able to trade crypto for fiat securely
            without ever exposing your personal identity or banking data on-chain.
          </p>
        </motion.div>

        <div className="flex flex-col gap-32">
          {sections.map((section, idx) => (
            <motion.div
              variants={itemVariants}
              key={section.id}
              className={`grid gap-12 lg:grid-cols-2 lg:gap-16 items-center ${idx % 2 === 1 ? 'lg:grid-flow-col-dense' : ''}`}
            >
              <div className={idx % 2 === 1 ? 'lg:col-start-2' : ''}>
                <h2 className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#06ffa5] mb-3">{section.headline}</h2>
                <h3 className="text-3xl font-medium text-white mb-6">{section.subheadline}</h3>
                <p className="text-white/60 leading-relaxed font-light">{section.body}</p>
              </div>
              <div className={idx % 2 === 1 ? 'lg:col-start-1' : ''}>
                <div className="w-full p-6 sm:p-8 flex flex-col justify-center items-center">
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] px-8 py-12 flex flex-col items-center justify-center w-full max-w-md shadow-2xl">
                    <img
                      src={section.icon}
                      alt={section.headline}
                      className="w-24 h-24 drop-shadow-xl"
                    />
                    <div className="mt-8 rounded-lg bg-black/40 border border-white/10 px-4 py-3 font-mono text-[11px] text-[#06ffa5] w-full text-center">
                      sys.init({'{'} {section.id} {'}'})
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
