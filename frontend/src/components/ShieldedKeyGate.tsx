import { useState } from "react";
import { useSession } from "../lib/session";
import { hasPasskeyUnlock } from "../lib/shieldedKey";

/**
 * Unlock modal for the in-memory shielded key. After a page refresh the shielded identity is gone
 * (never persisted — see session.tsx), so spending/shielding is disabled until it's re-derived.
 *
 * Presented as a small centered modal (not an inline section). Two equal ways in:
 *  • Passkey — Face ID / fingerprint, via the enrolled PRF-wrapped seed (shown only if enrolled).
 *  • PIN — re-runs the same PIN+email derivation as login.
 * Renders nothing when unlocked. Drop it anywhere a flow needs the shielded key.
 */
export default function ShieldedKeyGate() {
  const session = useSession();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState<null | "pin" | "passkey">(null);
  const [error, setError] = useState<string | null>(null);

  if (session.identity) return null;

  const biometricAvailable = session.email ? hasPasskeyUnlock(session.email) : false;

  async function unlockWithPin(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy("pin");
    setError(null);
    try {
      await session.unlockIdentityWithPin(pin);
      setPin("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not unlock your shielded key.");
    } finally {
      setBusy(null);
    }
  }

  async function unlockWithPasskey() {
    if (busy) return;
    setBusy("passkey");
    setError(null);
    try {
      await session.unlockIdentityWithPasskey();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Face ID unlock failed — try your PIN.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="relative w-full max-w-sm rounded-2xl border border-amber-400/20 bg-neutral-950/95 shadow-2xl p-6 space-y-5">
        <div className="space-y-1.5">
          <h2 className="text-white font-medium text-lg">Unlock your shielded key</h2>
          <p className="text-white/50 text-xs leading-relaxed">
            Your private balance is locked. Unlock it to send, shield, or spend privately — this
            key only proves ownership; moving funds always needs your passkey too.
          </p>
        </div>

        {biometricAvailable && (
          <>
            <button
              type="button"
              onClick={unlockWithPasskey}
              disabled={!!busy}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M12 15a3 3 0 100-6 3 3 0 000 6zm0 0v0m-7-4a8 8 0 0114 0m-14 0a8 8 0 0014 0" /></svg>
              {busy === "passkey" ? "Waiting for Face ID…" : "Unlock with Face ID / fingerprint"}
            </button>
            <div className="flex items-center gap-3 text-white/30 text-[11px] uppercase tracking-wider">
              <span className="h-px flex-1 bg-white/10" /> or use PIN <span className="h-px flex-1 bg-white/10" />
            </div>
          </>
        )}

        <form onSubmit={unlockWithPin} className="space-y-3">
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="Enter PIN"
            disabled={!!busy}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-amber-400/40"
          />
          <button
            type="submit"
            disabled={!!busy || pin.length < 4}
            className="w-full py-2.5 rounded-lg bg-amber-500/90 text-black text-sm font-medium hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {busy === "pin" ? "Unlocking…" : "Unlock with PIN"}
          </button>
        </form>

        {error && <p className="text-red-400/80 text-xs">{error}</p>}
      </div>
    </div>
  );
}
