import { Router } from 'express';
import { prisma } from '../db';

const router = Router();

// POST /notes/blob — store an encrypted note blob for a recipient (sender posts after transfer).
router.post('/blob', async (req, res) => {
    const { commitment, ephemeralPub, ciphertext } = req.body || {};
    if (!commitment || !ephemeralPub || !ciphertext) {
        return res.status(400).json({ error: 'commitment, ephemeralPub and ciphertext are required.' });
    }
    try {
        const row = await prisma.noteBlob.create({ data: { commitment: String(commitment), ephemeralPub: String(ephemeralPub), ciphertext: String(ciphertext) } });
        res.json({ id: row.id });
    } catch (e: any) {
        res.status(500).json({ error: e?.message || 'store blob failed' });
    }
});

// GET /notes/since/:cursor — fetch new blobs (id > cursor) for the recipient to trial-decrypt.
router.get('/since/:cursor', async (req, res) => {
    const cursor = Number(req.params.cursor) || 0;
    try {
        const blobs = await prisma.noteBlob.findMany({
            where: { id: { gt: cursor } },
            orderBy: { id: 'asc' },
            take: 500,
            select: { id: true, commitment: true, ephemeralPub: true, ciphertext: true },
        });
        const nextCursor = blobs.length ? blobs[blobs.length - 1].id : cursor;
        res.json({ blobs, nextCursor });
    } catch (e: any) {
        res.status(500).json({ error: e?.message || 'scan failed' });
    }
});

// GET /notes/identity/:email — resolve a recipient's published shielded identity (for email sends).
router.get('/identity/:email', async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { email: String(req.params.email) },
            select: { shieldedOwner: true, shieldedEncPub: true, shieldedAddress: true },
        });
        if (!user?.shieldedOwner || !user?.shieldedEncPub) {
            return res.status(404).json({ error: 'No shielded identity for that user.' });
        }
        res.json({ owner: user.shieldedOwner, encPub: user.shieldedEncPub, address: user.shieldedAddress });
    } catch (e: any) {
        res.status(500).json({ error: e?.message || 'identity lookup failed' });
    }
});

export default router;
