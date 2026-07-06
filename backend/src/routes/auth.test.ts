import { describe, it, expect, afterEach, vi } from 'vitest';
import request from 'supertest';

// verifyIdToken is a shared mock so each test can control its resolve/reject behavior.
// vi.hoisted is required because vi.mock's factory runs before these const declarations.
const { verifyIdTokenMock } = vi.hoisted(() => ({
  verifyIdTokenMock: vi.fn(),
}));

vi.mock('firebase-admin/app', () => ({
  cert: vi.fn(),
  getApps: vi.fn(() => [{}]), // pretend an app is already initialized — skip real credential setup
  initializeApp: vi.fn(),
}));

vi.mock('firebase-admin/auth', () => ({
  getAuth: vi.fn(() => ({ verifyIdToken: verifyIdTokenMock })),
}));

import { app } from '../app';

afterEach(() => {
  verifyIdTokenMock.mockReset();
});

describe('POST /auth/session', () => {
  it('rejects a missing idToken with 400', async () => {
    const res = await request(app).post('/auth/session').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('rejects a non-string idToken with 400', async () => {
    const res = await request(app).post('/auth/session').send({ idToken: 12345 });
    expect(res.status).toBe(400);
  });

  it('returns 401 without leaking internals when token verification fails (bad signature/expired/wrong audience)', async () => {
    verifyIdTokenMock.mockRejectedValue(new Error('Firebase ID token has invalid signature: some internal stack trace detail'));
    const res = await request(app).post('/auth/session').send({ idToken: 'bad.token.here' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid or expired social login token.');
    // must not leak the underlying error message/stack
    expect(JSON.stringify(res.body)).not.toContain('internal stack trace');
  });

  it('returns 401 when the payload has no email claim', async () => {
    verifyIdTokenMock.mockResolvedValue({ uid: 'user-sub-1', email_verified: true });
    const res = await request(app).post('/auth/session').send({ idToken: 'valid.token' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Social login did not return a verified email.');
  });

  it('returns 401 when email_verified is explicitly false', async () => {
    verifyIdTokenMock.mockResolvedValue({ uid: 'user-sub-2', email: 'user@example.com', email_verified: false });
    const res = await request(app).post('/auth/session').send({ idToken: 'valid.token' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Social login did not return a verified email.');
  });

  it('accepts a valid token with email + email_verified: true, returning { email, providerSub }', async () => {
    verifyIdTokenMock.mockResolvedValue({ uid: 'user-sub-3', email: 'verified@example.com', email_verified: true });
    const res = await request(app).post('/auth/session').send({ idToken: 'valid.token' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ email: 'verified@example.com', providerSub: 'user-sub-3' });
  });

  it('treats an absent email_verified field as verified (some email-link providers never set it)', async () => {
    verifyIdTokenMock.mockResolvedValue({ uid: 'user-sub-4', email: 'nofield@example.com' });
    const res = await request(app).post('/auth/session').send({ idToken: 'valid.token' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ email: 'nofield@example.com', providerSub: 'user-sub-4' });
  });

  it('maps uid to providerSub in the response', async () => {
    verifyIdTokenMock.mockResolvedValue({ uid: 'stable-verifier-id-xyz', email: 'sub@example.com', email_verified: true });
    const res = await request(app).post('/auth/session').send({ idToken: 'valid.token' });
    expect(res.status).toBe(200);
    expect(res.body.providerSub).toBe('stable-verifier-id-xyz');
  });

  it('omits providerSub when uid is not a string', async () => {
    verifyIdTokenMock.mockResolvedValue({ uid: 12345, email: 'nosub@example.com', email_verified: true });
    const res = await request(app).post('/auth/session').send({ idToken: 'valid.token' });
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('nosub@example.com');
    expect(res.body.providerSub).toBeUndefined();
  });
});
