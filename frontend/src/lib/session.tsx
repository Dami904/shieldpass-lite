import { createContext, useContext, useState, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import type { SmartAccountWalletClient } from '@shieldpass/sdk/dist/smartAccount'
import type { ShieldedIdentity } from '@shieldpass/sdk/dist/identity'
import { lockBankVault } from './bankVault'

/** A shielded note the user owns (owner-based model; spent with the user's shielded key). */
export interface ShieldedNote {
  amount: string
  asset: string
  randomness: string   // per-note uniqueness; needed (with the shielded key) to spend
  leafIndex: number
  compliance: { hardware_attested: string; bvn_verified: string; good_standing: string }
  confirmed?: boolean  // undefined = unknown (legacy), false = proof pending, true = on-chain
}

interface SessionState {
  email: string
  name: string
  phone: string
  secretSalt: string | null
  merkleRoot: string | null
  wallet: SmartAccountWalletClient | null
  identity: ShieldedIdentity | null // shielded keys (in-memory; re-derived from passkey PRF)
  shieldedAddress: string | null    // public "shp_…" address (persisted, shareable)
  credentialId: string
  address: string | null // C-address smart wallet
  bvnVerified: boolean
  notes: ShieldedNote[] // shielded balance = sum of these notes (faucet seed + deposits + change)
  // A new-account faucet note that is still settling on-chain in the background. Held here (not in
  // `notes`) so it does NOT count toward the shielded balance until it settles — the poll hook
  // (usePendingFaucet) proves + inserts it, then moves it into `notes`. Cleared on settle/timeout.
  pendingFaucet: { commitment: string; amount: string; randomness: string; asset: string;
    compliance: { hardware_attested: string; bvn_verified: string; good_standing: string } } | null
}

export interface Session extends SessionState {
  onboarded: boolean
  set: (patch: Partial<SessionState>) => void
  addNote: (note: ShieldedNote) => boolean // functional append; dedupes by randomness; returns true if added
  confirmNote: (leafIndex: number) => void  // mark a note as on-chain confirmed
  reset: () => void
  /** Re-derive shielded identity from PIN after a page reload (no passkey prompt). */
  unlockIdentityWithPin: (pin: string) => Promise<void>
  /** Unlock the shielded identity with the device passkey (Face ID / fingerprint) via the PRF wrap. */
  unlockIdentityWithPasskey: () => Promise<void>
}

const EMPTY: SessionState = {
  email: '', name: '', phone: '',
  secretSalt: null, merkleRoot: null,
  wallet: null, identity: null, shieldedAddress: null,
  credentialId: '', address: null,
  bvnVerified: false, notes: [], pendingFaucet: null,
}

const STORAGE_KEY = 'shieldpass_session'

// `wallet` and `identity` are live/secret objects — never persisted. The wallet is
// re-created via connectWallet(credentialId); the identity is re-derived from the passkey PRF.
type Persisted = Omit<SessionState, 'wallet' | 'identity'>

function loadPersisted(): SessionState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return EMPTY
    const p = JSON.parse(raw) as Persisted
    return { ...EMPTY, ...p, wallet: null, identity: null }
  } catch {
    return EMPTY
  }
}

function savePersisted(s: SessionState) {
  const { wallet: _wallet, identity: _identity, ...rest } = s
  void _wallet; void _identity
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rest)) } catch { /* ignore quota */ }
}

const SessionCtx = createContext<Session | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>(loadPersisted)
  // Notes that already existed when this provider mounted (i.e. survived a page reload).
  // Only THESE need auto-retry — notes added during this session are handled by
  // proveAndConfirm (fire-and-forget) and must NOT be retried concurrently.
  const initialNoteIndices = useRef(new Set(loadPersisted().notes.map(n => n.leafIndex)))

  // Reconnect the wallet client on page reload — silent, no WebAuthn prompt.
  // Identity (shielded keys) is NOT rehydrated here; it is re-derived from PIN
  // when the user next logs in or explicitly unlocks via unlockIdentityWithPin().
  useEffect(() => {
    if (state.credentialId && !state.wallet) {
      import('./smartAccount').then(({ makeWallet }) => {
        makeWallet().then(async w => {
          try { await w.connectWallet(state.credentialId, state.address ?? undefined) }
          catch (e) { console.error('[session] reconnect failed:', e) }
          setState(s => { const next = { ...s, wallet: w }; savePersisted(next); return next; })
        }).catch(console.error)
      }).catch(console.error)
    }
  }, [state.credentialId, state.wallet, state.address])

  // On mount, retry any notes that never landed on-chain (browser closed mid-proof).
  // Re-runs when new notes are added (length change), but NOT when confirmed flips
  // (avoids an infinite loop of re-triggering after marking notes confirmed).
  // Only retries notes that existed BEFORE this session started — notes added during
  // this session are being proved by proveAndConfirm (fire-and-forget) and must not
  // be retried concurrently to avoid duplicate confirms.
  useEffect(() => {
    const unconfirmed = state.notes.filter(
      n => n.confirmed !== true && initialNoteIndices.current.has(n.leafIndex)
    )
    if (unconfirmed.length === 0) return
    let cancelled = false
    import('./useInsertProof').then(({ retryPendingProofs }) => {
      retryPendingProofs(unconfirmed).then(confirmedIndices => {
        if (cancelled || confirmedIndices.length === 0) return
        setState(s => {
          const next = { ...s, notes: s.notes.map(n =>
            confirmedIndices.includes(n.leafIndex) ? { ...n, confirmed: true } : n
          )}
          savePersisted(next)
          return next
        })
      }).catch(() => {})
    }).catch(() => {})
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.notes.length])

  const value: Session = {
    ...state,
    onboarded: !!(state.secretSalt && state.address),
    set: (patch) => setState((s) => { const next = { ...s, ...patch }; savePersisted(next); return next }),
    addNote: (note) => {
      let added = false
      setState((s) => {
        if (s.notes.some((n) => n.randomness === note.randomness)) return s
        added = true
        const next = { ...s, notes: [...s.notes, note] }
        savePersisted(next)
        return next
      })
      return added
    },
    confirmNote: (leafIndex: number) => {
      setState(s => {
        const next = { ...s, notes: s.notes.map(n => n.leafIndex === leafIndex ? { ...n, confirmed: true } : n) }
        savePersisted(next)
        return next
      })
    },
    reset: () => {
      try {
        localStorage.removeItem(STORAGE_KEY)
        // Reset scan cursors so the NEXT login re-scans the blob store from 0 and rebuilds
        // the shielded balance. Notes are recoverable from encrypted blobs (faucet, received
        // and change are all published), so wiping the local cache here is safe — but only if
        // the scanner starts fresh; otherwise it resumes past already-seen blobs and misses them.
        if (state.email) localStorage.removeItem(`shp_scan_cursor_${state.email}`)
        if (state.address) {
          localStorage.removeItem(`shieldpass_incoming_cursor_${state.address}`)
          localStorage.removeItem(`shieldpass_incoming_seen_${state.address}`)
        }
      } catch { /* ignore */ }
      lockBankVault(); setState(EMPTY)
    },
    unlockIdentityWithPin: async (pin: string) => {
      const email = state.email
      if (!email) throw new Error('No account in this session — log in from the start screen.')
      const { deriveSeedFromPassword, deriveIdentityFromSeed } = await import('./shieldedKey')
      const { unlockBankVault } = await import('./bankVault')
      const seed = await deriveSeedFromPassword(pin, email)
      const identity = deriveIdentityFromSeed(seed)
      // Guard against a wrong PIN: a mismatched PIN silently derives a DIFFERENT (but
      // valid-looking) identity that can't decrypt the user's notes or spend them. The
      // shp_ address is persisted at onboarding, so verify the derived identity matches
      // before committing it — otherwise reject so the UI can show "incorrect PIN".
      if (state.shieldedAddress && identity.address !== state.shieldedAddress) {
        throw new Error('Incorrect PIN — could not unlock your shielded key.')
      }
      await unlockBankVault(seed, email)
      setState(s => { const next = { ...s, identity }; savePersisted(next); return next })
    },
    unlockIdentityWithPasskey: async () => {
      const email = state.email
      if (!email) throw new Error('No account in this session — log in from the start screen.')
      const { unlockSeedWithPasskey, deriveIdentityFromSeed } = await import('./shieldedKey')
      const { unlockBankVault } = await import('./bankVault')
      // Face ID / fingerprint → PRF → decrypt the enrolled seed wrap. Same guard as PIN: the
      // derived identity must match the persisted shp_ address, else reject.
      const seed = await unlockSeedWithPasskey(email, state.credentialId || undefined)
      const identity = deriveIdentityFromSeed(seed)
      if (state.shieldedAddress && identity.address !== state.shieldedAddress) {
        throw new Error('Could not unlock your shielded key with this passkey.')
      }
      await unlockBankVault(seed, email)
      setState(s => { const next = { ...s, identity }; savePersisted(next); return next })
    },
  }
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>
}

export function useSession(): Session {
  const ctx = useContext(SessionCtx)
  if (!ctx) throw new Error('useSession must be used within a SessionProvider')
  return ctx
}
