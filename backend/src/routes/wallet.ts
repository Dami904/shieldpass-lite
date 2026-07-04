import { Router } from 'express';
import { submitSigned, relay } from '../services/passkey';

const router = Router();

// smart-account-kit relayer proxy. The kit's RelayerClient POSTs { func, auth } (gasless invoke)
// or { xdr } (signed tx to fee-bump, e.g. wallet deploy) and expects a RelayerResponse back.
router.post('/relay', async (req, res) => {
  const { func, auth, xdr } = req.body ?? {};
  if (!xdr && !func) {
    return res.status(400).json({ success: false, error: 'Provide either { func, auth } or { xdr }.', errorCode: 'INVALID_PARAMS' });
  }
  const result = await relay({ func, auth, xdr });
  // Always 200 with the RelayerResponse body — the kit reads `success`/`error` from the payload.
  return res.json(result);
});

// Legacy gasless submit relay (passkey-kit): the browser passkey signs, the backend submits.
// Kept as a fallback while the smart-account-kit migration is verified in the browser.
router.post('/submit', async (req, res) => {
  const { signedXdr } = req.body;
  if (!signedXdr || typeof signedXdr !== 'string') {
    return res.status(400).json({ error: 'signedXdr (string) is required.' });
  }
  try {
    const hash = await submitSigned(signedXdr);
    return res.json({ success: true, hash });
  } catch (e: any) {
    console.error('[wallet] channels submit failed:', e);
    return res.status(502).json({ error: 'Gasless submission failed.', detail: e.message });
  }
});

export default router;
