import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

/** Hash a PIN as `salt:hash` (hex) using scrypt. No external dependency. */
export function hashPin(pin: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(pin, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

/** Constant-time verify of a PIN against a stored `salt:hash`. */
export function verifyPin(pin: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(pin, salt, 32);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCKOUT_MS = 15 * 60 * 1000;

export interface PinLockState {
  failedPinAttempts: number;
  pinLockedUntil: Date | null;
}

/** The lock's expiry if one is currently active, otherwise null. Pure — takes `now` for tests. */
export function activePinLock(state: PinLockState, now = new Date()): Date | null {
  return state.pinLockedUntil && state.pinLockedUntil > now ? state.pinLockedUntil : null;
}

/** Next persisted state after a failed PIN attempt — locks once MAX_PIN_ATTEMPTS is reached. */
export function recordFailedPinAttempt(state: PinLockState, now = new Date()): PinLockState {
  const failedPinAttempts = state.failedPinAttempts + 1;
  const pinLockedUntil =
    failedPinAttempts >= MAX_PIN_ATTEMPTS ? new Date(now.getTime() + PIN_LOCKOUT_MS) : state.pinLockedUntil;
  return { failedPinAttempts, pinLockedUntil };
}

/** Next persisted state after a successful PIN check — clears the counter and any lock. */
export function clearPinLock(): PinLockState {
  return { failedPinAttempts: 0, pinLockedUntil: null };
}
