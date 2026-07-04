import { rpc } from '@stellar/stellar-sdk';

/**
 * Per-account async mutex for transaction submission.
 *
 * Every transaction consumes its source account's sequence number. Two builders that
 * fetch `getAccount().sequenceNumber()` concurrently produce txs with the SAME sequence;
 * the network accepts the first to land and silently rejects the rest at ledger apply
 * (txBAD_SEQ). The rejected tx still gets a hash back at submit time, so the symptom is a
 * "submitted" hash that never lands and a `waitForLanding` timeout — exactly what bites the
 * relayer account, which is the source for faucet_seed, the merkle insert, pool funding,
 * wallet seeding and gasless relayed invokes all at once during onboarding.
 *
 * `withAccountLock` serializes everything keyed on the source public key, so txs from the
 * same account run strictly one-at-a-time while different accounts still run in parallel.
 * Hold the lock across submit AND landing (see `waitForLanding`) so the next builder always
 * reads a sequence number that has advanced past the previous tx.
 */
const chains = new Map<string, Promise<unknown>>();

export function withAccountLock<T>(accountKey: string, fn: () => Promise<T>): Promise<T> {
    const prev = chains.get(accountKey) ?? Promise.resolve();
    // Run fn regardless of how the previous holder settled (.then(fn, fn)).
    const run = prev.then(fn, fn);
    // Keep the chain alive for the next caller, swallowing this run's result/error so one
    // failure never poisons the lock for subsequent transactions.
    chains.set(accountKey, run.then(() => undefined, () => undefined));
    return run;
}

/** Poll until a submitted tx is committed to a ledger (or throw on failure/timeout). */
export async function waitForLanding(server: rpc.Server, hash: string, timeoutMs = 180_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const r = await server.getTransaction(hash);
        if (r.status === rpc.Api.GetTransactionStatus.SUCCESS) return;
        if (r.status === rpc.Api.GetTransactionStatus.FAILED)
            throw new Error(`tx ${hash} failed on-chain`);
        await new Promise(resolve => setTimeout(resolve, 1500));
    }
    throw new Error(`tx ${hash} not confirmed within ${timeoutMs}ms`);
}
