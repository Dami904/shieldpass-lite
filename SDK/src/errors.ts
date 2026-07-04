/**
 * Turns any thrown value (Error, string, raw Stellar/Soroban JSON, etc.) into a short,
 * user-friendly message plus the original technical detail (for an expandable "details" view).
 *
 * Shared by the frontend (toasts / inline errors) and the backend (client-facing responses)
 * so users never see raw `HostError: Error(WasmVm, InvalidAction) … UnreachableCodeReached` walls.
 */
export interface HumanError {
  /** Short, friendly headline safe to show a user. */
  title: string;
  /** The original technical message, truncated — keep for debugging / an expandable view. */
  detail: string;
}

const MAX_DETAIL = 600;

/**
 * Dynamically extract the contract address and method name from a
 * "Contract <ID> has no method \"<fn>\"" error thrown by the Stellar SDK,
 * and return a user-friendly title that includes the actual contract address
 * so the error message updates automatically whenever the contract changes.
 */
function buildNoMethodTitle(raw: string): string | null {
  // Matches: Contract CXXX has no method "deposit"
  const m = raw.match(/Contract\s+([A-Z2-7]{56})\s+has no method\s+["']?(\w+)["']?/i);
  if (!m) return null;
  const [, contractId, method] = m;
  const short = `${contractId.slice(0, 8)}…${contractId.slice(-6)}`;
  return `Contract ${short} doesn't support "${method}". The contract address in your environment may be wrong or outdated.`;
}

// Most specific → least specific. First matching rule wins.
const RULES: { test: RegExp; title: string | ((raw: string) => string) }[] = [
  {
    // Dynamic: contract address mismatch — "Contract CXXX has no method \"deposit\"".
    // Title is built at runtime so it always reflects the actual contract in the error.
    test: /has no method/i,
    title: (raw: string) => buildNoMethodTitle(raw) ?? 'The contract rejected this call — the contract address may be misconfigured.',
  },
  {
    // Contract not found / wrong address deployed.
    test: /contract.*not found|no contract.*deployed|no such contract|invalid contract/i,
    title: 'Contract not found on-chain. The configured contract address may be wrong.',
  },
  {
    // On-chain token transfer reverted: a panicking contract traps the WASM VM.
    // In this app that almost always means the wallet has nothing to lock.
    test: /unreachablecodereached|invalidaction|insufficient|\bbalance\b|trapped|not enough/i,
    title: "You don't have enough balance to complete this. Add funds and try again.",
  },
  {
    test: /already (used|spent)|nullifier|replay/i,
    title: 'This proof was already used. Re-verify to continue.',
  },
  {
    test: /proof|witness|circuit|bb\.js|prove/i,
    title: "Couldn't generate your privacy proof. Refresh the page and try again.",
  },
  {
    test: /notallowederror|webauthn|passkey|user (declined|cancel|denied)|aborted|abort/i,
    title: 'The passkey prompt was dismissed. Try again and approve it on your device.',
  },
  {
    test: /failed to fetch|networkerror|err_network|fetch failed|network request failed/i,
    title: 'Network problem — check your connection and try again.',
  },
  {
    test: /timed out|timeout|not available/i,
    title: 'This is taking longer than expected. It may still go through — check back shortly.',
  },
  {
    test: /channels|relayer|gasless|submission failed|submit failed/i,
    title: "Couldn't submit your transaction. Please try again in a moment.",
  },
  {
    // Generic Stellar/Soroban failure that didn't match a friendlier rule above.
    test: /simulation failed|hosterror|wasmvm|soroban|stellar/i,
    title: 'The blockchain rejected this transaction. Please try again.',
  },
];

const FALLBACK = 'Something went wrong. Please try again.';

function rawMessage(err: unknown): string {
  if (err == null) return '';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  try {
    return typeof (err as any).message === 'string' ? (err as any).message : JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function humanizeError(err: unknown): HumanError {
  const raw = rawMessage(err);
  const detail = raw.length > MAX_DETAIL ? `${raw.slice(0, MAX_DETAIL - 1)}…` : raw;
  const rule = RULES.find((r) => r.test.test(raw));
  if (!rule) return { title: FALLBACK, detail };
  const title = typeof rule.title === 'function' ? rule.title(raw) : rule.title;
  return { title, detail };
}
