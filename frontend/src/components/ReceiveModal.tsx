import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useSession } from "../lib/session";

/**
 * "Receive privately" — shows a QR that encodes a deep link to the Send page,
 * prefilled with this user's shielded (shp_) address. Another ShieldPass user can
 * scan it (phone camera opens the app, or the in-app scanner) and the funds arrive
 * as a private shielded note. Works even when the shielded key is locked, since
 * shieldedAddress is persisted and receiving needs no private key.
 */
export default function ReceiveModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const session = useSession();
  const [copied, setCopied] = useState(false);
  if (!open) return null;

  const shp = session.shieldedAddress;
  const deepLink = shp ? `${window.location.origin}/send?to=${encodeURIComponent(shp)}` : "";

  const copy = async () => {
    if (!shp) return;
    try {
      await navigator.clipboard.writeText(shp);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the QR still works */
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-3xl border border-indigo-500/20 bg-gradient-to-br from-blue-900/40 to-indigo-900/30 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-white font-medium">Receive privately</h3>
          <button onClick={onClose} className="text-white/40 hover:text-white text-2xl leading-none">×</button>
        </div>
        <p className="text-white/40 text-xs mb-4 leading-relaxed">
          Have another ShieldPass user scan this. Funds arrive as a private shielded note — sender,
          receiver and amount stay hidden.
        </p>

        {shp ? (
          <>
            <div className="flex justify-center mb-4">
              <div className="rounded-2xl bg-white p-3">
                <QRCodeSVG value={deepLink} size={200} level="M" />
              </div>
            </div>
            <button
              onClick={copy}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left hover:bg-white/10 transition-colors"
            >
              <div className="text-white/40 text-[10px] font-mono uppercase tracking-wider mb-0.5">
                Your shielded address
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-white/80 text-xs font-mono truncate">{shp}</span>
                <span className="text-xs text-indigo-300 shrink-0">{copied ? "Copied" : "Copy"}</span>
              </div>
            </button>
            <p className="text-white/30 text-[11px] mt-3 leading-relaxed">
              Prefer not to share this? They can also just send to your{" "}
              <span className="text-white/50">email</span> — same private result.
            </p>
          </>
        ) : (
          <p className="text-amber-400/80 text-sm">
            No shielded address on this account yet. Finish onboarding to get one.
          </p>
        )}
      </div>
    </div>
  );
}
