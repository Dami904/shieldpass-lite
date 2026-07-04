import { Router } from 'express';
import { TrustedIssuer, isValidSorobanAddress, noteCommitment, encryptNote } from '@shieldpass/sdk';
import { prisma } from '../db';

const fromHex = (s: string) => Uint8Array.from(s.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
const toHex = (u8: Uint8Array) => Buffer.from(u8).toString('hex');
import { treeService } from '../services/tree';
import { notify } from './notifications';
import { verifyBvn } from '../services/bvn';
import { hashPin, verifyPin, activePinLock, recordFailedPinAttempt, clearPinLock } from '../services/pin';
import { seedWalletFromEnv, type SeedResult } from '../services/seed';
import { pinLimiter } from '../middleware/rateLimit';

const router = Router();
const issuer = new TrustedIssuer();

// Faucet seed is configurable (no hardcoded amount). Change FAUCET_NOTE_AMOUNT /
// FAUCET_NOTE_ASSET in the backend env to adjust the onboarding seed someday.
const FAUCET_NOTE_AMOUNT = BigInt(process.env.FAUCET_NOTE_AMOUNT || '5000000000'); // 500 XLM in stroops (7 decimals)
const FAUCET_NOTE_ASSET = process.env.FAUCET_NOTE_ASSET || 'XLM';

// Re-issue a compliance leaf from the user's current Tier flags and persist it.
// hardwareAttested is always true once a passkey is linked; bvnVerified flips to true at Tier 2.
async function issueLeaf(userId: string, hardwareAttested: boolean, bvnVerified: boolean) {
  const goodStanding = true;
  const secretSalt = issuer.generateSecretSalt();
  const leafCommitment = issuer.generateLeaf(BigInt(secretSalt), hardwareAttested, bvnVerified, goodStanding);
  const { merkle_root } = issuer.generateMerkleProof(leafCommitment);
  await prisma.complianceAttestation.upsert({
    where: { userId },
    update: { leafCommitment, merkleRoot: merkle_root, leafIndex: 0, hardwareAttested, bvnVerified, goodStanding },
    create: { userId, leafCommitment, merkleRoot: merkle_root, leafIndex: 0, hardwareAttested, bvnVerified, goodStanding },
  });
  return { secretSalt, merkleRoot: merkle_root, leafIndex: 0 };
}

// ── Tier 1: Passkey-first onboarding ──
// Link a freshly-created passkey smart wallet to the user (creating the user if needed).
// Issues a Tier 1 compliance leaf (hardwareAttested = true, bvnVerified = false) and returns the
// secret salt. NO BVN required here — small swaps only need the hardware (passkey) attestation.
router.post('/link-wallet', async (req, res) => {
  const { email, pin, smartWalletAddress, passkeyKeyId, shieldedOwner, shieldedEncPub, shieldedAddress } = req.body;
  if (!email || !smartWalletAddress) return res.status(400).json({ error: 'email and smartWalletAddress are required.' });
  if (!isValidSorobanAddress(smartWalletAddress)) return res.status(400).json({ error: 'Invalid smart wallet address.' });
  if (pin && !/^\d{4,6}$/.test(String(pin))) return res.status(400).json({ error: 'PIN must be 4-6 digits.' });

  try {
    const pinHash = pin ? hashPin(String(pin)) : undefined;
    // Determine NEW vs RETURNING before we upsert: the private faucet is a one-time welcome
    // bonus for brand-new accounts only. A user who already has a compliance attestation has
    // onboarded before, so they must NOT receive the faucet again (even if the client took the
    // signup path). A bare user row with no attestation = half-finished onboarding → still new.
    const preexisting = await prisma.user.findUnique({ where: { email }, include: { attestation: true } });
    const alreadyOnboarded = !!preexisting?.attestation;

    // Publish the shielded identity (owner/encPub/address) so others can send by email.
    const shielded = (shieldedOwner && shieldedEncPub) ? { shieldedOwner, shieldedEncPub, shieldedAddress } : {};
    const user = await prisma.user.upsert({
      where: { email },
      update: { smartWalletAddress, passkeyKeyId: passkeyKeyId ?? null, ...(pinHash ? { pinHash } : {}), ...shielded },
      create: { email, smartWalletAddress, passkeyKeyId: passkeyKeyId ?? null, pinHash, ...shielded },
    });

    // Tier 1 leaf: hardware-attested, not yet BVN-verified.
    const leaf = await issueLeaf(user.id, true, false);

    // PRIVATE FAUCET (owner-based, NEW ACCOUNTS ONLY): seed a note OWNED by the user's shielded
    // owner. The note is backed by the pool; the user holds the shielded key (sk) to spend it.
    //
    // Sign-in stays fast: settling on-chain (faucet_seed + pool funding) runs in the BACKGROUND
    // after this response. The client is told the faucet is pending and polls GET
    // /kyc/faucet-status until the note is fully backed — so the shielded balance only ever shows
    // the 500 once it's real (hide-until-settled). If settling fails after retries, we fall back
    // to a PUBLIC seed so the user isn't left empty-handed; no shielded note is ever surfaced.
    const grantFaucet = !!shieldedOwner && !alreadyOnboarded;
    let faucetSecret: {
      amount: string; randomness: string; asset: string; commitment: string;
      compliance: { hardware_attested: string; bvn_verified: string; good_standing: string };
    } | undefined;

    if (grantFaucet) {
      const noteAmount = FAUCET_NOTE_AMOUNT; // configurable via env
      const randomness = BigInt(issuer.generateSecretSalt()); // per-note uniqueness
      const compliance = { hardware_attested: 1n, bvn_verified: 0n, good_standing: 1n };
      const commitment = noteCommitment(noteAmount, BigInt(shieldedOwner), randomness, compliance);
      const displayAmount = (Number(noteAmount) / 1e7).toString(); // stroops → XLM for display
      const complianceStr = { hardware_attested: '1', bvn_verified: '0', good_standing: '1' };

      // The client keeps `randomness` (with their shielded key) to spend the note later, and
      // `commitment` to poll faucet-status. The tree index + circuit input come from the status
      // endpoint once the note is reserved (i.e. after settling succeeds).
      faucetSecret = {
        amount: noteAmount.toString(), randomness: randomness.toString(),
        asset: FAUCET_NOTE_ASSET, commitment: commitment.toString(), compliance: complianceStr,
      };

      // ── Background: settle on-chain, then reserve the leaf + publish the recovery blob ──
      void (async () => {
        try {
          const settled = await treeService.settleFaucetOnChain(commitment);
          if (settled) {
            // Reserve the tree index + circuit input ONLY after the pool is funded (so a failed
            // faucet never leaves an orphaned pending leaf). faucet-status reads this back.
            const { index } = await treeService.faucetAssign(commitment);
            console.log(`[kyc/link-wallet] backed + reserved ${noteAmount} ${FAUCET_NOTE_ASSET} ZK Note at index ${index}.`);

            // SELF-addressed encrypted blob so the balance is recoverable from the blob store
            // after a logout / new device. Shape MUST match useNoteScanner.
            try {
              const plaintext = new TextEncoder().encode(JSON.stringify({
                amount: noteAmount.toString(), randomness: randomness.toString(),
                compliance: complianceStr, asset: FAUCET_NOTE_ASSET,
              }));
              const { ephemeralPublic, ciphertext } = encryptNote(fromHex(shieldedEncPub), plaintext);
              await prisma.noteBlob.create({
                data: { commitment: commitment.toString(), ephemeralPub: toHex(ephemeralPublic), ciphertext: toHex(ciphertext) },
              });
            } catch (blobErr) {
              console.error('[kyc/link-wallet] faucet blob publish failed:', blobErr);
            }
            notify(email, 'FAUCET', `Welcome bonus received`, { amount: displayAmount, asset: FAUCET_NOTE_ASSET }).catch(() => {});
          } else {
            // Couldn't back the shielded note — public fallback so the user still gets funds.
            console.warn('[kyc/link-wallet] faucet settle failed after retries — falling back to public seed.');
            const results = await seedWalletFromEnv(smartWalletAddress);
            const funded = results.some((r) => r.status === 'funded' || r.status === 'skipped');
            for (const r of results) {
              if (r.status === 'funded') console.log(`[kyc/link-wallet] fallback seeded ${r.tokenId} -> ${smartWalletAddress} tx:${r.hash}`);
              if (r.status === 'failed') console.error(`[kyc/link-wallet] fallback seed failed for ${r.tokenId}:`, r.error);
            }
            if (funded) notify(email, 'FAUCET', `Welcome bonus received`, { amount: displayAmount, asset: FAUCET_NOTE_ASSET }).catch(() => {});
          }
        } catch (err) {
          console.error('[kyc/link-wallet] faucet provisioning failed:', err);
        }
      })();
    }

    return res.json({ success: true, tier: 1, ...leaf, faucetPending: grantFaucet, faucetSecret });
  } catch (err) {
    console.error('[kyc/link-wallet]', err);
    return res.status(409).json({ error: 'Could not link wallet (it may already be linked).' });
  }
});

// GET /kyc/faucet-status?commitment=<c> — poll the background faucet settlement (new signups only).
// Returns { state: 'settled', leafIndex, circuitInput } once the note is backed on-chain and its
// tree index is reserved; { state: 'pending' } while still settling. NO proving happens here — it's
// a pure DB read. The client generates the merkle_insert proof CLIENT-SIDE from circuitInput and
// only then surfaces the shielded 500 (hide-until-settled). If settling ultimately fails, the leaf
// is never reserved so this stays 'pending' — the client gives up after a timeout and the public
// fallback shows in the wallet balance instead.
router.get('/faucet-status', async (req, res) => {
  const commitment = String(req.query.commitment || '');
  if (!commitment) return res.status(400).json({ error: 'commitment query param is required.' });
  try {
    const index = await treeService.indexOf(commitment);
    if (index === null) return res.json({ state: 'pending' });
    const leaf = await treeService.getLeaf(index);
    return res.json({ state: 'settled', leafIndex: index, circuitInput: leaf?.circuitInput ?? null });
  } catch (err) {
    console.error('[kyc/faucet-status]', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ── Tier 2: BVN upgrade ──
// Triggered when a user wants to swap above the high-value threshold. Verifies the BVN and issues
// a NEW compliance leaf with bvnVerified = true. Returns the new secret salt.
//
// Zero-storage: the legal name the BVN check returns, and the phone number submitted with it,
// are NEVER written to the User row — only the boolean bvnVerified flag persists (in
// ComplianceAttestation, via issueLeaf below). `returnedName` is handed back in the response for
// the frontend to cache client-side (session.name), exactly like the app already treats bank
// details — it lives in the browser, not the database.
router.post('/submit-bvn', async (req, res) => {
  const { email, bvn } = req.body;
  if (!email || typeof email !== 'string') return res.status(400).json({ error: 'email is required.' });
  if (!bvn || bvn.length !== 11 || !/^\d{11}$/.test(bvn)) {
    return res.status(400).json({ error: 'A valid 11-digit numeric BVN is required.' });
  }

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ error: 'No account for that email (link a wallet first).' });

    const check = await verifyBvn(bvn);
    if (!check.ok) return res.status(400).json({ error: 'BVN verification failed.' });

    // Tier 2 leaf: hardware-attested AND BVN-verified.
    const leaf = await issueLeaf(user.id, true, true);

    return res.json({
      success: true,
      tier: 2,
      message: 'BVN verified. Identity upgraded — high-value swaps unlocked.',
      returnedName: check.returnedName,
      ...leaf,
    });
  } catch (err) {
    console.error('[kyc/submit-bvn]', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Verify a returning user's PIN (second factor for passkey reconnect).
// How long a caller has to wait before the lockout on their account clears.
function retryAfterSeconds(lockedUntil: Date): number {
  return Math.max(1, Math.ceil((lockedUntil.getTime() - Date.now()) / 1000));
}

router.post('/verify-pin', pinLimiter, async (req, res) => {
  const { email, pin } = req.body;
  if (!email || !pin) return res.status(400).json({ error: 'email and pin are required.' });
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.status(404).json({ error: 'No user for that email.' });

  const lockedUntil = activePinLock(user);
  if (lockedUntil) {
    return res.status(429).json({ error: 'Too many incorrect attempts. Try again later.', retryAfterSeconds: retryAfterSeconds(lockedUntil) });
  }

  const ok = !!user.pinHash && verifyPin(String(pin), user.pinHash);
  await prisma.user.update({ where: { id: user.id }, data: ok ? clearPinLock() : recordFailedPinAttempt(user) });

  return res.json({
    ok,
    passkeyKeyId: ok ? user.passkeyKeyId : undefined,
    smartWalletAddress: ok ? user.smartWalletAddress : undefined
  });
});

// Re-issue a fresh compliance secret salt for a returning user (login on a new device).
// Preserves the user's current Tier (hardwareAttested / bvnVerified) so they keep their level.
router.post('/reissue-salt', pinLimiter, async (req, res) => {
  const { email, pin } = req.body;
  if (!email || !pin) return res.status(400).json({ error: 'email and pin are required.' });
  try {
    const user = await prisma.user.findUnique({ where: { email }, include: { attestation: true } });
    if (!user) return res.status(404).json({ error: 'No user for that email.' });

    const lockedUntil = activePinLock(user);
    if (lockedUntil) {
      return res.status(429).json({ error: 'Too many incorrect attempts. Try again later.', retryAfterSeconds: retryAfterSeconds(lockedUntil) });
    }

    const ok = !!user.pinHash && verifyPin(String(pin), user.pinHash);
    await prisma.user.update({ where: { id: user.id }, data: ok ? clearPinLock() : recordFailedPinAttempt(user) });
    if (!ok) return res.status(401).json({ error: 'Incorrect PIN.' });
    if (!user.attestation) return res.status(409).json({ error: 'Link a wallet before logging in.' });

    const leaf = await issueLeaf(user.id, user.attestation.hardwareAttested, user.attestation.bvnVerified);
    return res.json({ success: true, bvnVerified: user.attestation.bvnVerified, ...leaf });
  } catch (err) {
    console.error('[kyc/reissue-salt]', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Look up the account linked to a smart wallet — used by login on a new device.
router.get('/account', async (req, res) => {
  const wallet = String(req.query.wallet || '');
  if (!wallet) return res.status(400).json({ error: 'wallet query param is required.' });
  const user = await prisma.user.findUnique({ where: { smartWalletAddress: wallet }, include: { attestation: true } });
  if (!user) return res.status(404).json({ error: 'No account for that wallet.' });
  return res.json({ email: user.email, bvnVerified: user.attestation?.bvnVerified ?? false });
});

export default router;
