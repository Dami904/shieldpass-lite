import { Router } from 'express';
import { checkProof, burnNullifier } from '../services/compliance';
import { prisma } from '../db';
import { logger } from '../logger';

const router = Router();

// Generic relayer endpoint: verify a ZK compliance proof and burn its nullifier.
// (The Trustless Swap flow does its own proof verification in /swap/execute; this remains as a
// standalone verify-and-burn endpoint for compliance proofs not tied to a swap.)
router.post('/submit-proof', async (req, res) => {
  const { walletAddress, proof, publicInputs, nullifier, action } = req.body;

  if (!walletAddress || !proof || !action) {
    return res.status(400).json({ error: 'walletAddress, proof, and action are required.' });
  }
  if (!nullifier) {
    return res.status(400).json({ error: 'nullifier is required (single-use replay protection).' });
  }
  if (!Array.isArray(publicInputs)) {
    return res.status(400).json({ error: 'publicInputs must be an array of field strings.' });
  }

  const check = await checkProof({ proof, publicInputs, nullifier });
  if (!check.ok) return res.status(check.status).json({ error: check.error });
  logger.info({ walletAddress }, '[Relayer] ZK Proof Verified');

  // Proof is valid — record it and burn the nullifier so it can never be replayed.
  const txHash = `verified_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  try {
    const transaction = await prisma.relayerTransaction.create({
      data: { walletAddress, action, txHash, status: 'verified' },
    });
    await burnNullifier(String(nullifier), walletAddress, action);
    return res.json({
      success: true,
      message: 'Proof verified and nullifier burned.',
      transaction,
    });
  } catch (err) {
    logger.error({ err }, '[Relayer] DB write failed');
    return res.status(500).json({ error: 'Internal Server Error.' });
  }
});

export default router;
