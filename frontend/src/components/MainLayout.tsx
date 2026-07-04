import React, { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import { GradientBackground } from "./ui/paper-design-shader-background";
import { DarkBackground } from "./ui/background-snippets";
import { useSession } from "../lib/session";
import { useNoteScanner } from "../lib/useNoteScanner";
import { usePendingFaucet } from "../lib/usePendingFaucet";
import { useIncomingTransactions } from "../lib/useIncomingTransactions";
import { api } from "../lib/api";
import { assetByCode, formatUnits } from "../lib/assets";
import NotificationBell from "./NotificationBell";


import DarkVeil from "./ui/DarkVeil";

interface MainLayoutProps {
  children: React.ReactNode;
  walletComponent?: React.ReactNode;
}

export default function MainLayout({
  children,
  walletComponent,
}: MainLayoutProps) {
  const location = useLocation();
  const currentPath = location.pathname;
  const isActive = (path: string) => currentPath === path;
  const session = useSession();

  // Settle a new-account faucet note that's still confirming on-chain, then reveal it once real.
  usePendingFaucet();

  // Background scan for incoming private (shielded) payments.
  useNoteScanner(import.meta.env.VITE_API_URL as string, (amount, asset) => {
    if (session.email) {
      // `amount` arrives as raw stroops from the scanner — format it to human units
      // (e.g. 270000000 → "27 XLM") before showing it in the notification.
      const formatted = formatUnits(BigInt(amount), assetByCode(asset)?.decimals ?? 7, 4);
      api.notify({ email: session.email, type: "RECEIVE_SHIELDED", title: "Private payment received", amount: formatted, asset }).catch(() => {});
    }
  });

  // Background poll for incoming public SAC transfers (XLM, USDC, NGNC).
  useIncomingTransactions();

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen flex flex-col relative font-sans">
      {/* Renders the background gradient requested by the user */}
      {["/withdraw", "/send", "/shield", "/dashboard", "/activity"].includes(currentPath) ? (
        <div className="fixed inset-0 -z-20">
          <DarkVeil speed={0.4} warpAmount={0.3} noiseIntensity={0.04} scanlineIntensity={0.2} scanlineFrequency={100} />
        </div>
      ) : !["/about", "/docs"].includes(currentPath) ? (
        <GradientBackground />
      ) : (
        <DarkBackground />
      )}
      <div className="fixed inset-0 -z-10 bg-black/20 pointer-events-none" />

      {/* FLOATING GLASS CAPSULE HEADER */}
      <motion.header
        initial={{ y: -40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5, ease: [0.25, 0.4, 0.25, 1] as any }}
        className="fixed top-4 left-4 right-4 md:left-8 md:right-8 z-50 flex items-center px-6 py-3.5 rounded-2xl bg-card backdrop-blur-md shadow-lg border border-border"
      >
        <div className="flex items-center flex-1">
          <Link
            to="/"
            className="flex items-center hover:opacity-80 transition-opacity"
          >
            <span className="nav-logo">SHIELDPASS</span>
          </Link>
        </div>

        {/* Restored Navigation Links */}
        <nav className="hidden md:flex flex-1 justify-center items-center gap-6 text-sm font-mono tracking-wider">
          {!session.onboarded && (
          <Link
            to="/onboarding"
            className={`flex items-center gap-2 transition-all duration-300 ${isActive("/onboarding") ? "opacity-100 font-semibold" : "opacity-60 hover:opacity-100"}`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            Verify Identity
          </Link>
          )}
          <Link
            to="/shield"
            className={`flex items-center gap-2 transition-all duration-300 ${isActive("/shield") ? "opacity-100 font-semibold" : "opacity-60 hover:opacity-100"}`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            Shield
          </Link>
          <Link
            to="/withdraw"
            className={`flex items-center gap-2 transition-all duration-300 ${isActive("/withdraw") ? "opacity-100 font-semibold" : "opacity-60 hover:opacity-100"}`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 20V8m0 0l-4 4m4-4l4 4M4 4h16" />
            </svg>
            Withdraw
          </Link>
          <Link
            to="/send"
            className={`flex items-center gap-2 transition-all duration-300 ${isActive("/send") ? "opacity-100 font-semibold" : "opacity-60 hover:opacity-100"}`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
            Send
          </Link>
          <Link
            to="/dashboard"
            className={`flex items-center gap-2 transition-all duration-300 ${isActive("/dashboard") ? "opacity-100 font-semibold" : "opacity-60 hover:opacity-100"}`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
            Dashboard
          </Link>
          {!session.onboarded && (
            <>
              <Link
                to="/about"
                className={`flex items-center gap-2 transition-all duration-300 ${isActive("/about") ? "opacity-100 font-semibold" : "opacity-60 hover:opacity-100"}`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                About
              </Link>
              <Link
                to="/docs"
                className={`flex items-center gap-2 transition-all duration-300 ${isActive("/docs") ? "opacity-100 font-semibold" : "opacity-60 hover:opacity-100"}`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
                Docs
              </Link>
            </>
          )}
          </nav>

    <div className="flex items-center justify-end gap-4 flex-1">
      {session.onboarded && <div className="z-10"><NotificationBell /></div>}
      {walletComponent && <div className="hidden md:block z-10">{walletComponent}</div>}

      {/* Mobile hamburger menu button */}
      <button
        onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        className="flex md:hidden items-center justify-center p-2 rounded-lg border border-border bg-muted hover:bg-accent transition-colors z-50 text-foreground cursor-pointer"
        aria-label="Toggle Navigation Menu"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          {isMobileMenuOpen ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" />
          )}
        </svg>
      </button>
    </div>
      </motion.header >

    {/* Mobile Drawer Menu Overlay */ }
    <AnimatePresence>
  {
    isMobileMenuOpen && (
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.25, ease: "easeInOut" }}
        className="fixed inset-0 z-40 bg-background/98 pt-28 px-8 flex flex-col gap-6 md:hidden"
      >
        <div className="flex flex-col gap-2 text-lg font-mono tracking-wider pt-6">
          {!session.onboarded && (
          <Link
            to="/onboarding"
            onClick={() => setIsMobileMenuOpen(false)}
            className={`flex items-center gap-3 py-4 border-b border-border ${isActive("/onboarding") ? "text-primary font-semibold" : "text-muted-foreground"}`}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            Verify Identity
          </Link>
          )}
          <Link
            to="/shield"
            onClick={() => setIsMobileMenuOpen(false)}
            className={`flex items-center gap-3 py-4 border-b border-border ${isActive("/shield") ? "text-primary font-semibold" : "text-muted-foreground"}`}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            Shield
          </Link>
          <Link
            to="/withdraw"
            onClick={() => setIsMobileMenuOpen(false)}
            className={`flex items-center gap-3 py-4 border-b border-border ${isActive("/withdraw") ? "text-primary font-semibold" : "text-muted-foreground"}`}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 20V8m0 0l-4 4m4-4l4 4M4 4h16" />
            </svg>
            Withdraw
          </Link>
          <Link
            to="/send"
            onClick={() => setIsMobileMenuOpen(false)}
            className={`flex items-center gap-3 py-4 border-b border-border ${isActive("/send") ? "text-primary font-semibold" : "text-muted-foreground"}`}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
            Send
          </Link>
          <Link
            to="/dashboard"
            onClick={() => setIsMobileMenuOpen(false)}
            className={`flex items-center gap-3 py-4 border-b border-border ${isActive("/dashboard") ? "text-primary font-semibold" : "text-muted-foreground"}`}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
            Dashboard
          </Link>
          {!session.onboarded && (
            <>
              <Link
                to="/about"
                onClick={() => setIsMobileMenuOpen(false)}
                className={`flex items-center gap-3 py-4 border-b border-white/5 ${isActive("/about") ? "text-indigo-400 font-semibold" : "text-white/60"}`}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                About
              </Link>
              <Link
                to="/docs"
                onClick={() => setIsMobileMenuOpen(false)}
                className={`flex items-center gap-3 py-4 border-b border-white/5 ${isActive("/docs") ? "text-indigo-400 font-semibold" : "text-white/60"}`}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
                Docs
              </Link>
            </>
          )}

          {/* Mobile Wallet Connection Trigger */}
          <div className="mt-8">
            {walletComponent}
          </div>
        </div>
      </motion.div>
    )
  }
      </AnimatePresence >

      {/* PRIMARY RENDER BLOCK */}
      <motion.main
        key={currentPath}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.25, 0.4, 0.25, 1] as any }}
        className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 md:px-12 pb-4 sm:pb-6 md:pb-12 pt-28 sm:pt-32 md:pt-36 relative z-10"
      >
        {children}
      </motion.main>
    </div>
  );
}
