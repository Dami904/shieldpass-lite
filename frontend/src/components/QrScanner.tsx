import { useEffect, useRef, useState } from "react";

/**
 * Minimal QR scanner using the native BarcodeDetector API (zero-dependency; works in
 * Chrome / Android / Edge). Calls onResult with the first decoded string, then the
 * caller closes it. Where BarcodeDetector or the camera isn't available, shows a
 * graceful fallback pointing the user at paste / email instead.
 */
export default function QrScanner({
  open,
  onClose,
  onResult,
}: {
  open: boolean;
  onClose: () => void;
  onResult: (text: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;

    const Detector = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (s: CanvasImageSource) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
    if (!Detector) {
      setError("Live scanning isn't supported in this browser. Paste the shp_ address, or have them send to your email instead.");
      return;
    }
    const detector = new Detector({ formats: ["qr_code"] });

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        const tick = async () => {
          if (stopped || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes && codes.length > 0 && codes[0].rawValue) {
              onResultRef.current(codes[0].rawValue);
              return; // stop on first successful read
            }
          } catch {
            /* transient decode error — keep scanning */
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        setError("Couldn't access the camera. Check permissions, or have them send to your email instead.");
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-3xl border border-indigo-500/20 bg-neutral-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-white font-medium">Scan recipient QR</h3>
          <button onClick={onClose} className="text-white/40 hover:text-white text-2xl leading-none">×</button>
        </div>
        {error ? (
          <p className="text-amber-400/80 text-sm leading-relaxed">{error}</p>
        ) : (
          <div className="overflow-hidden rounded-2xl bg-black aspect-square">
            <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
          </div>
        )}
      </div>
    </div>
  );
}
