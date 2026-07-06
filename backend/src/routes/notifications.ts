import { Router } from 'express';
import { prisma } from '../db';
import { logger } from '../logger';

const router = Router();

const TYPES = new Set([
    'FAUCET', 'SHIELD', 'UNSHIELD', 'WITHDRAW_FIAT', 'SEND_PUBLIC', 'SEND_SHIELDED', 'RECEIVE_SHIELDED', 'RECEIVE_PUBLIC', 'PAYOUT_SETTLED',
]);

/** Server-side helper so other routes (faucet, payout) can log notifications. */
export async function notify(email: string, type: string, title: string, extra?: { body?: string; amount?: string; asset?: string; txHash?: string }) {
    if (!email || !TYPES.has(type)) return;
    try {
        await prisma.notification.create({ data: { email, type, title, body: extra?.body, amount: extra?.amount, asset: extra?.asset, txHash: extra?.txHash } });
    } catch (e) {
        logger.error({ err: e }, '[notify] failed');
    }
}

// POST /notifications — record an action (client posts on success).
router.post('/', async (req, res) => {
    const { email, type, title, body, amount, asset, txHash } = req.body || {};
    if (!email || !TYPES.has(type) || !title) return res.status(400).json({ error: 'email, valid type and title are required.' });
    await notify(String(email), String(type), String(title), { body, amount, asset, txHash });
    res.json({ ok: true });
});

// GET /notifications?email= — recent feed + unread count.
router.get('/', async (req, res) => {
    const email = String(req.query.email || '');
    if (!email) return res.status(400).json({ error: 'email is required.' });
    try {
        const [items, unread] = await Promise.all([
            prisma.notification.findMany({ where: { email }, orderBy: { createdAt: 'desc' }, take: 50 }),
            prisma.notification.count({ where: { email, read: false } }),
        ]);
        res.json({ items, unread });
    } catch (e: any) {
        logger.error({ err: e }, '[notifications/list] failed');
        res.status(500).json({ error: e?.message || 'list failed' });
    }
});

// POST /notifications/read — mark all (or given ids) as read.
router.post('/read', async (req, res) => {
    const { email, ids } = req.body || {};
    if (!email) return res.status(400).json({ error: 'email is required.' });
    try {
        await prisma.notification.updateMany({
            where: { email: String(email), ...(Array.isArray(ids) && ids.length ? { id: { in: ids.map(String) } } : {}) },
            data: { read: true },
        });
        res.json({ ok: true });
    } catch (e: any) {
        logger.error({ err: e }, '[notifications/read] failed');
        res.status(500).json({ error: e?.message || 'mark-read failed' });
    }
});

export default router;
