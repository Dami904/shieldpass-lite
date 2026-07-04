import { motion } from "motion/react";

export default function DocsPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4 relative z-10">
      <motion.h1
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        className="text-4xl md:text-5xl font-bold text-white mb-6 font-display"
      >
        Documentation
      </motion.h1>
      <motion.p
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.2 }}
        className="text-lg md:text-xl text-white/70 max-w-2xl font-light leading-relaxed mb-8"
      >
        Our developer documentation, smart contract architecture, and zero-knowledge circuit schemas are currently being finalized for the testnet release.
      </motion.p>

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.8, delay: 0.4 }}
        className="px-6 py-3 rounded-full bg-white/5 border border-white/10 text-white/80 font-mono text-sm uppercase tracking-widest"
      >
        Coming Soon
      </motion.div>
    </div>
  );
}
