import { Router } from 'express';
import { treeServiceFor } from '../services/tree';

const router = Router();

// Resolve the target pool's tree service from a `pool` query/body field (the on-chain
// shielded_pool contract id). Omitted → default (XLM) pool. Unknown id → 400.
function svcFrom(poolId: unknown) {
    return treeServiceFor(typeof poolId === 'string' && poolId ? poolId : undefined);
}

// GET /tree/state?pool=<contractId> — current root + next free index for a pool.
router.get('/state', async (req, res) => {
    try {
        res.json(await svcFrom(req.query.pool).state());
    } catch (e: any) {
        res.status(500).json({ error: e?.message || 'tree state failed' });
    }
});

// GET /tree/path/:index?pool=<contractId> — sibling path + index bits (membership proof input).
router.get('/path/:index', async (req, res) => {
    const index = Number(req.params.index);
    if (!Number.isInteger(index) || index < 0) return res.status(400).json({ error: 'invalid index' });
    try {
        res.json(await svcFrom(req.query.pool).pathFor(index));
    } catch (e: any) {
        res.status(500).json({ error: e?.message || 'tree path failed' });
    }
});

// ── Client-side proving: two-step insert ──────────────────────────────────────

/**
 * POST /tree/assign
 * Body: { commitment: string, pool?: string }   (pool = shielded_pool contract id)
 * Returns: { index, circuitInput }
 */
router.post('/assign', async (req, res) => {
    const { commitment, pool } = req.body || {};
    if (!commitment || !/^\d+$/.test(String(commitment))) {
        return res.status(400).json({ error: 'commitment (decimal field element) is required' });
    }
    try {
        const result = await svcFrom(pool).assignInsert(BigInt(commitment));
        res.json(result);
    } catch (e: any) {
        console.error('[tree/assign] FAILED commitment=%s pool=%s error=%s', commitment, pool, e?.message);
        res.status(500).json({ error: e?.message || 'assign failed' });
    }
});

/**
 * POST /tree/confirm
 * Body: { index, proof_a[], proof_b[], proof_c[], public_signals[][], pool? }
 * Returns: { txHash? }
 */
router.post('/confirm', async (req, res) => {
    const { index, proof_a, proof_b, proof_c, public_signals, pool } = req.body || {};
    if (typeof index !== 'number' || !proof_a || !proof_b || !proof_c || !public_signals) {
        return res.status(400).json({ error: 'index, proof_a, proof_b, proof_c and public_signals are required' });
    }
    try {
        const proof = {
            a: Uint8Array.from(proof_a),
            b: Uint8Array.from(proof_b),
            c: Uint8Array.from(proof_c),
        };
        const signals: Uint8Array[] = (public_signals as number[][]).map((s) => Uint8Array.from(s));
        const result = await svcFrom(pool).confirmInsert(index, proof, signals);
        res.json(result);
    } catch (e: any) {
        console.error('[tree/confirm] FAILED index=%s pool=%s error=%s', index, pool, e?.message);
        res.status(500).json({ error: e?.message || 'confirm failed' });
    }
});

// GET /tree/index/:commitment?pool=<contractId> — resolve a commitment to its leaf index.
router.get('/index/:commitment', async (req, res) => {
    try {
        const index = await svcFrom(req.query.pool).indexOf(String(req.params.commitment));
        if (index === null) return res.status(404).json({ error: 'commitment not in tree' });
        res.json({ index });
    } catch (e: any) {
        res.status(500).json({ error: e?.message || 'tree index lookup failed' });
    }
});

/**
 * GET /tree/retry/:index?pool=<contractId>
 * Recover a stuck pending proof without re-calling /tree/assign.
 */
router.get('/retry/:index', async (req, res) => {
    const index = Number(req.params.index);
    if (!Number.isInteger(index) || index < 0) return res.status(400).json({ error: 'invalid index' });
    try {
        const leaf = await svcFrom(req.query.pool).getLeaf(index);
        if (!leaf) return res.status(404).json({ error: 'leaf not found (may have been rolled back)' });
        if (leaf.status === 'confirmed') return res.json({ status: 'confirmed' });
        if (!leaf.circuitInput) return res.status(409).json({ error: 'no circuitInput stored for this leaf' });
        res.json({ index, status: 'pending', circuitInput: leaf.circuitInput });
    } catch (e: any) {
        res.status(500).json({ error: e?.message || 'retry lookup failed' });
    }
});

// GET /tree/pending-count — monitoring: how many leaves are currently awaiting proof submission.
router.get('/pending-count', async (_req, res) => {
    try {
        const { prisma } = await import('../db');
        const count = await prisma.treeLeaf.count({ where: { status: 'pending' } });
        res.json({ count });
    } catch (e: any) {
        res.status(500).json({ error: e?.message });
    }
});

export default router;
