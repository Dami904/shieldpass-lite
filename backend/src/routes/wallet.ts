import { Router } from 'express';
import { relay } from '../services/passkey';

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

export default router;
