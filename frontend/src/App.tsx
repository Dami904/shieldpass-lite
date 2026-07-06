import { useState } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useNavigate,
} from "react-router-dom";
import MainLayout from "./components/MainLayout";
import { SessionProvider, useSession } from "./lib/session";

import LandingPage from "./pages/LandingPage";
import OnboardingPage from "./pages/OnboardingPage";
import SwapPage from "./pages/SwapPage";
import SendPage from "./pages/SendPage";
import ActivityPage from "./pages/ActivityPage";
import DashboardPage from "./pages/DashboardPage";
import AboutPage from "./pages/AboutPage";
import DocsPage from "./pages/DocsPage";
import NotFoundPage from "./pages/notfound";

function ProfileButton() {
  const session = useSession();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  if (!session.onboarded) return null;

  async function disconnect() {
    setOpen(false);
    // Clear the kit's stored session (IndexedDB) so the wallet fully disconnects, then wipe local state.
    try { await session.wallet?.disconnect(); } catch { /* best-effort */ }
    session.reset();
    navigate("/");
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="font-mono text-xs border border-white/10 bg-white/5 px-4 py-2 rounded-xl text-white/70 hover:text-white hover:bg-white/10 transition-all flex items-center gap-2"
      >
        {session.email}
        <svg className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-44 rounded-xl border border-white/10 bg-zinc-900/95 backdrop-blur p-1 z-50 shadow-xl">
            <button
              onClick={disconnect}
              className="w-full text-left px-3 py-2 rounded-lg text-sm font-mono text-red-400 hover:bg-white/5 transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Disconnect
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function App() {
  return (
    <SessionProvider>
      <Router>
        <Routes>
          <Route path="/" element={<LandingPage />} />

        <Route
          path="/onboarding"
          element={<OnboardingPage />}
        />

        <Route path="/withdraw" element={
          <MainLayout walletComponent={<ProfileButton />}>
            <SwapPage />
          </MainLayout>
        } />
        <Route path="/swap" element={<Navigate to="/withdraw" replace />} />

        {/* Shielding is automatic on deposit now — old links redirect to the dashboard. */}
        <Route path="/shield" element={<Navigate to="/dashboard" replace />} />
        <Route path="/deposit" element={<Navigate to="/dashboard" replace />} />
        <Route path="/unshield" element={<Navigate to="/dashboard" replace />} />

        <Route path="/send" element={
          <MainLayout walletComponent={<ProfileButton />}>
            <SendPage />
          </MainLayout>
        } />

        <Route path="/activity" element={
          <MainLayout walletComponent={<ProfileButton />}>
            <ActivityPage />
          </MainLayout>
        } />

        <Route path="/dashboard" element={
          <MainLayout walletComponent={<ProfileButton />}>
            <DashboardPage />
          </MainLayout>
        } />

        <Route path="/about" element={
          <MainLayout walletComponent={<ProfileButton />}>
            <AboutPage />
          </MainLayout>
        } />

        <Route path="/docs" element={
          <MainLayout walletComponent={<ProfileButton />}>
            <DocsPage />
          </MainLayout>
        } />

  {/* Redirect old marketplace links to swap */ }
        <Route path="/marketplace" element={<Navigate to="/withdraw" replace />} />

        <Route path="*" element={
          <MainLayout walletComponent={<ProfileButton />}>
            <NotFoundPage />
          </MainLayout>
        } />
      </Routes >
    </Router >
    </SessionProvider >
  );
}
