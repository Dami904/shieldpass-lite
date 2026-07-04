import { humanizeError } from "@shieldpass/sdk/dist/errors";

/**
 * Renders a caught error as a friendly headline, with the raw technical detail tucked behind a
 * "Technical details" toggle. Plain strings are treated as already-friendly (shown as-is, no
 * toggle) so intentional inline messages aren't mangled by the humaniser.
 */
export default function ErrorNotice({ error, className = "" }: { error: unknown; className?: string }) {
  if (!error) return null;
  const { title, detail } =
    typeof error === "string" ? { title: error, detail: "" } : humanizeError(error);

  return (
    <div className={className}>
      <p className="text-red-400 text-sm font-medium">{title}</p>
      {detail && detail !== title && (
        <details className="mt-1.5">
          <summary className="text-red-400/40 text-xs cursor-pointer select-none hover:text-red-400/70">
            Technical details
          </summary>
          <pre className="text-red-300/40 text-[10px] leading-relaxed mt-1 whitespace-pre-wrap break-all max-h-32 overflow-auto">
            {detail}
          </pre>
        </details>
      )}
    </div>
  );
}
