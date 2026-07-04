import { Networks, Keypair } from '@stellar/stellar-sdk';
import {
    IncrementalMerkleTree, buildInsertInput, ShieldedPoolClient, fieldToBytes32,
} from '@shieldpass/sdk';
import { StellarContractClient } from '@shieldpass/sdk/dist/stellar';
import { prisma } from '../db';
import { type PoolConfig, getPoolConfig, defaultPoolId, allPoolIds } from './pools';

const RELAYER_SECRET = process.env.STELLAR_RELAYER_SECRET || '';
const RPC_URL = process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org';
const NETWORK = process.env.STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET;

const DEPTH = 20;

// Pending leaves expire after 2 minutes — if the browser closed mid-proof.
const PENDING_TTL_MS = 2 * 60 * 1000;

/**
 * Server-side mirror of ONE on-chain commitment tree (one shielded_pool instance).
 * Each asset has its own pool/tree, so there is one TreeService per pool — see the
 * `treeServiceFor` registry below. Responsibilities:
 *  1. Source of truth for membership paths (to build spend proofs in the browser).
 *  2. Coordinates the merkle_insert flow: backend assigns an index + circuit input,
 *     browser proves, browser returns the proof, backend submits on-chain.
 *
 * The faucet seedNote path is the ONLY place prove() still runs server-side, and only
 * for the faucet pool (XLM) at signup.
 */
class TreeService {
    private tree = new IncrementalMerkleTree(DEPTH);
    private loaded = false;
    // Serializes all tree-advancing ops so concurrent requests can't race the
    // shared tree / leaf index (critical on a single Render instance).
    private chain: Promise<unknown> = Promise.resolve();

    constructor(private readonly pool: PoolConfig) {}

    private get poolId(): string { return this.pool.poolId; }

    private serialize<T>(fn: () => Promise<T>): Promise<T> {
        const run = this.chain.then(() => fn());
        this.chain = run.then(() => undefined, () => undefined);
        return run;
    }

    /** Rebuild the in-memory tree from this pool's persisted leaves (idempotent). */
    private async ensureLoaded(): Promise<void> {
        if (this.loaded) return;
        const leaves = await prisma.treeLeaf.findMany({
            where: { poolId: this.poolId },
            orderBy: { index: 'asc' },
        });
        for (const l of leaves) this.tree.setLeaf(l.index, BigInt(l.commitment));
        (this.tree as unknown as { count: number }).count = leaves.length;
        this.loaded = true;
    }

    async state(): Promise<{ root: string; nextIndex: number }> {
        await this.ensureLoaded();
        return { root: this.tree.root().toString(), nextIndex: this.tree.nextIndex };
    }

    /**
     * Sibling path + index bits for the leaf at `index` (for membership proofs).
     *
     * Built from CONFIRMED (on-chain-landed) leaves only, so a leaf that was assigned but never
     * inserted on-chain (e.g. a stuck change note) can never poison the root a spend proof commits
     * to. The returned root therefore always equals the on-chain current_root — the only root the
     * contract accepts — which stops the recurring "unknown merkle root" trap at its source.
     */
    async pathFor(index: number): Promise<{ siblings: string[]; indices: string[]; root: string }> {
        const confirmed = await prisma.treeLeaf.findMany({
            where: { poolId: this.poolId, status: 'confirmed' },
            orderBy: { index: 'asc' },
            select: { index: true, commitment: true },
        });
        if (index >= confirmed.length) {
            throw new Error(`[tree] leaf ${index} is not yet confirmed on-chain in pool ${this.poolId} — cannot build a spendable membership proof.`);
        }
        const tree = new IncrementalMerkleTree(DEPTH);
        for (const l of confirmed) tree.setLeaf(l.index, BigInt(l.commitment));
        (tree as unknown as { count: number }).count = confirmed.length;
        // Belt-and-suspenders: verify this confirmed-only root actually matches on-chain before we
        // hand it out; if the DB itself is corrupt, fail loudly instead of serving a dead root.
        await this.assertSyncedWithChain();
        const siblings = tree.path(index).map(String);
        const indices: string[] = [];
        let idx = index;
        for (let i = 0; i < DEPTH; i++) { indices.push(String(idx & 1)); idx = Math.floor(idx / 2); }
        return { siblings, indices, root: tree.root().toString() };
    }

    /** Look up the index of a known commitment in this pool (so the client can fetch its path). */
    async indexOf(commitment: string): Promise<number | null> {
        const row = await prisma.treeLeaf.findFirst({
            where: { poolId: this.poolId, commitment },
            select: { index: true },
        });
        return row ? row.index : null;
    }

    // ── Chain sync guard ─────────────────────────────────────────────────────

    /**
     * Verify the in-memory tree matches the on-chain contract — in BOTH leaf count AND root.
     * If they diverge, throw immediately so the caller gets a clear error instead of submitting a
     * proof built against a root the contract never attested (which traps on-chain with an opaque
     * UnreachableCodeReached on every unshield/swap/insert).
     *
     * Checking the root (not just the count) is essential: a DB with the SAME number of leaves but
     * DIFFERENT commitments than on-chain (e.g. leftover leaves from a redeployed contract) passes
     * a count check yet produces a root that is not a ValidRoot on-chain — silently breaking every
     * private operation. That exact divergence is what this guard now catches.
     */
    private async assertSyncedWithChain(): Promise<void> {
        if (!this.poolId || !RELAYER_SECRET) return;
        try {
            const pool = new ShieldedPoolClient(RPC_URL, NETWORK, this.poolId);
            const chainIndex = await pool.nextIndex();
            // Compare CONFIRMED DB leaves only — pending leaves are legitimately ahead of the
            // chain (they are in-flight proofs, not committed yet).
            const confirmed = await prisma.treeLeaf.findMany({
                where: { poolId: this.poolId, status: 'confirmed' },
                orderBy: { index: 'asc' },
                select: { index: true, commitment: true },
            });
            if (chainIndex !== confirmed.length) {
                throw new Error(
                    `[tree] DIVERGED (pool ${this.poolId}): DB has ${confirmed.length} confirmed leaves, chain has ${chainIndex}. ` +
                    `A previous insert tx likely failed after the DB was marked confirmed. ` +
                    `To recover without redeploying, run in Neon: ` +
                    `UPDATE "TreeLeaf" SET status='pending' WHERE "poolId"='${this.poolId}' AND status='confirmed' AND index >= ${chainIndex};`
                );
            }
            // Same count — now confirm the CONTENT matches by comparing the confirmed-only root to
            // the on-chain current_root. A mismatch means the DB leaves aren't the ones committed
            // on-chain, so every membership proof would be rejected.
            const confirmedTree = new IncrementalMerkleTree(DEPTH);
            for (const l of confirmed) confirmedTree.setLeaf(l.index, BigInt(l.commitment));
            (confirmedTree as unknown as { count: number }).count = confirmed.length;
            const dbRoot = confirmedTree.root();
            const chainRoot = BigInt('0x' + Buffer.from(await pool.currentRoot()).toString('hex'));
            if (dbRoot !== chainRoot) {
                throw new Error(
                    `[tree] DIVERGED (pool ${this.poolId}): DB root ${dbRoot} != on-chain root ${chainRoot} ` +
                    `(both ${confirmed.length} leaves). The backend tree does not match the deployed contract, ` +
                    `so proofs will be rejected on-chain. Reset the tree (clear TreeLeaf for this pool and ` +
                    `re-init/redeploy the pool), or rebuild TreeLeaf from the on-chain insert history.`
                );
            }
        } catch (e: any) {
            if (e.message?.includes('DIVERGED')) throw e;
            console.warn('[tree] chain sync check skipped (RPC unreachable?):', e.message);
        }
    }

    // ── Client-side proving flow ──────────────────────────────────────────────

    /**
     * Step 1 of client-side insert: atomically advance the in-memory tree, persist
     * the leaf as "pending", and return the circuit input the browser needs to prove.
     */
    async assignInsert(commitment: bigint): Promise<{
        index: number;
        circuitInput: Record<string, unknown>;
    }> {
        return this.serialize(async () => {
            await this.ensureLoaded();
            await this.assertSyncedWithChain();
            const index = this.tree.nextIndex;
            const circuitInput = buildInsertInput(this.tree, commitment); // mutates tree
            await prisma.treeLeaf.create({
                data: { poolId: this.poolId, index, commitment: commitment.toString(), status: 'pending', assignedAt: new Date(), circuitInput: circuitInput as any },
            });
            console.log(`[tree/assign] pool=${this.poolId} index=${index} commitment=${commitment}`);
            return { index, circuitInput };
        });
    }

    /**
     * Step 2 of client-side insert: receive the browser-generated proof, submit it
     * on-chain via the relayer keypair (cheap — no RAM spike), mark leaf confirmed.
     * Returns the on-chain tx hash.
     */
    async confirmInsert(
        index: number,
        proof: { a: Uint8Array; b: Uint8Array; c: Uint8Array },
        publicSignals: Uint8Array[],
    ): Promise<{ txHash?: string }> {
        // Validate the leaf exists and is pending
        const leaf = await prisma.treeLeaf.findUnique({ where: { poolId_index: { poolId: this.poolId, index } } });
        if (!leaf) throw new Error(`No leaf at index ${index} in pool ${this.poolId}`);
        if (leaf.status === 'confirmed') {
            console.warn(`[tree/confirm] pool=${this.poolId} index=${index} already confirmed — skipping`);
            return { txHash: undefined };
        }

        // NEVER mark a leaf confirmed without actually landing the insert on-chain.
        if (!this.poolId || !RELAYER_SECRET) {
            throw new Error('[tree/confirm] pool contract id / RELAYER_SECRET not configured — refusing to mark leaf confirmed (would diverge the tree).');
        }
        const pool = new ShieldedPoolClient(RPC_URL, NETWORK, this.poolId);
        // new_root this insert proves (public_signals[1]). The on-chain current_root must equal this
        // for the insert to have landed — that's our single source of truth for what really happened.
        const expectedRoot = BigInt('0x' + Buffer.from(publicSignals[1]).toString('hex'));

        let txHash: string | undefined;
        let submitErr: unknown;
        try {
            txHash = await pool.insert(proof, publicSignals, Keypair.fromSecret(RELAYER_SECRET));
            await pool.waitForLanding(txHash);
        } catch (err) {
            // Submission/landing errored (e.g. `read ECONNRESET` from the RPC). The insert may STILL
            // have landed — decide from the chain root below rather than assuming failure.
            submitErr = err;
        }

        let chainRoot: bigint;
        try {
            chainRoot = BigInt('0x' + Buffer.from(await pool.currentRoot()).toString('hex'));
        } catch {
            // Can't read the chain either — leave the pending leaf for the TTL/retry and surface the error.
            throw submitErr instanceof Error ? submitErr : new Error('[tree/confirm] insert failed and chain unreachable.');
        }

        if (chainRoot === expectedRoot) {
            // The insert landed (whether or not the submit call threw). Confirm it.
            await prisma.treeLeaf.update({ where: { poolId_index: { poolId: this.poolId, index } }, data: { status: 'confirmed' } });
            if (submitErr) console.warn(`[tree/confirm] pool=${this.poolId} index=${index} landed despite transient error: ${submitErr instanceof Error ? submitErr.message : submitErr}`);
            else console.log(`[tree/confirm] pool=${this.poolId} index=${index} tx=${txHash} (root verified against chain)`);
            return { txHash };
        }

        // The insert did NOT land. Roll the pending leaf back IMMEDIATELY (don't wait for the 2-min
        // TTL) — a lingering pending leaf poisons the shared in-memory tree and blocks EVERY other
        // user's insert. The browser can re-assign + re-prove.
        await this.rollbackPendingFrom(index);
        throw submitErr instanceof Error ? submitErr
            : new Error(`[tree/confirm] pool=${this.poolId} index=${index}: insert did not land on-chain — rolled back.`);
    }

    /**
     * Roll back pending leaves at `index` and above, and invalidate the in-memory tree so it
     * rebuilds without them. Pending leaves are an append-only tail; a failed insert at `index`
     * means nothing at or above it can have landed on-chain, so they must all be dropped. This is
     * the fast path that stops one failed/interrupted insert from stalling everyone.
     */
    async rollbackPendingFrom(index: number): Promise<void> {
        const { count } = await prisma.treeLeaf.deleteMany({
            where: { poolId: this.poolId, status: 'pending', index: { gte: index } },
        });
        this.loaded = false; // force a clean rebuild from confirmed leaves on the next request
        if (count > 0) console.warn(`[tree/rollback] pool=${this.poolId} rolled back ${count} pending leaf(ves) >= ${index}; in-memory tree invalidated`);
    }

    /** Fetch a stored pending leaf (for the browser's /tree/retry recovery). */
    async getLeaf(index: number) {
        return prisma.treeLeaf.findUnique({ where: { poolId_index: { poolId: this.poolId, index } } });
    }

    // ── Faucet assign (client-side proving) ──────────────────────────────────

    /**
     * Reserve a tree index for a faucet note and return the circuit input the browser
     * needs to prove. DB/tree only — NO on-chain I/O, so it never blocks sign-in.
     */
    async faucetAssign(commitment: bigint): Promise<{ index: number; circuitInput: Record<string, unknown> }> {
        return this.assignInsert(commitment);
    }

    /**
     * Settle a faucet note on-chain (faucet pool only). A faucet MUST land unfailingly, so this
     * self-heals: it retries the step(s) that didn't land and NEVER re-runs a step that already
     * succeeded within this call (re-seeding a Pending commitment panics; fundWallet moves real
     * crypto so re-funding would double-pay). Returns true only when the note is fully backed —
     * the caller hands the user a shielded note ONLY on true, else falls back to a public seed.
     *  1. faucet_seed(commitment) — registers the note commitment as Pending (gas only).
     *  2. fundWallet(pool, faucetAmount) — backs the note with real crypto so it can be unshielded.
     */
    async settleFaucetOnChain(commitment: bigint): Promise<boolean> {
        if (!this.poolId || !RELAYER_SECRET) return false;
        if (!this.pool.faucet) {
            console.warn(`[tree/faucet] pool ${this.poolId} is not a faucet pool — skipping settle`);
            return false;
        }
        const pool = new ShieldedPoolClient(RPC_URL, NETWORK, this.poolId);
        const relayer = Keypair.fromSecret(RELAYER_SECRET);
        const sac = this.pool.sacAddress;
        const needsFunding = !!sac;
        if (!needsFunding) console.warn('[tree/faucet] pool SAC not set — pool not funded, unshield will fail');

        const MAX_ATTEMPTS = 3;
        let seeded = false;
        let funded = false;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            try {
                if (!seeded) {
                    // faucetSeed waits for landing internally, so `seeded` only flips once it's on-chain.
                    await pool.faucetSeed(fieldToBytes32(commitment), relayer);
                    seeded = true;
                    console.log(`[tree/faucet] faucet_seed landed for commitment=${commitment}`);
                }
                if (sac && !funded) {
                    const stellar = new StellarContractClient(RPC_URL, NETWORK, sac);
                    // fundWallet waits for landing internally (see SDK accountLock), so `funded`
                    // only flips once the pool transfer is committed.
                    const fundHash = await stellar.fundWallet(sac, this.poolId, this.pool.faucetAmount, relayer);
                    funded = true;
                    console.log(`[tree/faucet] funded pool ${this.pool.faucetAmount} stroops tx=${fundHash}`);
                }
                return needsFunding ? funded : seeded;
            } catch (err) {
                console.error(`[tree/faucet] settle attempt ${attempt}/${MAX_ATTEMPTS} failed:`, err instanceof Error ? err.message : err);
                if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 2000 * attempt));
            }
        }
        return needsFunding ? seeded && funded : seeded;
    }

    // ── Background cleanup ────────────────────────────────────────────────────

    /** Roll back this pool's pending leaves stuck past PENDING_TTL_MS. */
    async cleanupExpiredPending(): Promise<void> {
        const cutoff = new Date(Date.now() - PENDING_TTL_MS);
        const stale = await prisma.treeLeaf.findMany({
            where: { poolId: this.poolId, status: 'pending', assignedAt: { lt: cutoff } },
        });
        if (stale.length === 0) return;

        const indices = stale.map((l) => l.index);
        console.warn(`[tree/cleanup] pool=${this.poolId} rolling back ${stale.length} expired pending leaf(ves):`,
            indices.map((i) => `index=${i}`).join(', '));

        await prisma.treeLeaf.deleteMany({ where: { poolId: this.poolId, index: { in: indices } } });

        // Force a full rebuild on the next operation so the in-memory tree drops these.
        this.loaded = false;
        console.log('[tree/cleanup] in-memory tree invalidated — will rebuild on next request');
    }
}

// ── Per-pool registry ─────────────────────────────────────────────────────────

const registry = new Map<string, TreeService>();

/**
 * Get the TreeService for a pool. `poolId` is the on-chain shielded_pool contract id
 * the frontend used for its deposit/unshield/swap invoke; omit it to use the default
 * (XLM) pool. Throws on an unknown, non-empty pool id so a bad request can't write into
 * the wrong tree.
 */
export function treeServiceFor(poolId?: string): TreeService {
    const cfg = getPoolConfig(poolId);
    if (!cfg) throw new Error(`unknown shielded pool: ${poolId}`);
    let svc = registry.get(cfg.poolId);
    if (!svc) { svc = new TreeService(cfg); registry.set(cfg.poolId, svc); }
    return svc;
}

/** The default-pool (XLM) service. Kept for the faucet path and back-compat callers. */
export const treeService = treeServiceFor(defaultPoolId());

// Run the cleanup check every 60 seconds across ALL configured pools.
setInterval(() => {
    for (const id of allPoolIds()) treeServiceFor(id).cleanupExpiredPending().catch(() => {});
}, 60_000);
