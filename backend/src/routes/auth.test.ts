import { describe, it, expect, afterEach, vi } from 'vitest';
import request from 'supertest';

// jwtVerify is a shared mock so each test can control its resolve/reject behavior. decodeProtectedHeader
// and importJWK are mocked too since the route calls them directly (no createRemoteJWKSet — see auth.ts
// for why). vi.hoisted is required because vi.mock's factory runs before these const declarations.
const { jwtVerifyMock } = vi.hoisted(() => ({
  jwtVerifyMock: vi.fn(),
}));

vi.mock('jose', () => ({
  decodeProtectedHeader: vi.fn(() => ({ kid: 'test-kid', alg: 'ES256' })),
  importJWK: vi.fn(async (jwk) => jwk),
  jwtVerify: jwtVerifyMock,
}));

// getJwks() calls the global fetch — stub it so tests never make a real network call.
vi.stubGlobal('fetch', vi.fn(async () => ({
  ok: true,
  json: async () => ({ keys: [{ kid: 'test-kid', kty: 'EC', crv: 'P-256', x: 'x', y: 'y' }] }),
})));

import { app } from '../app';

afterEach(() => {
  jwtVerifyMock.mockReset();
});

describe('POST /auth/web3auth', () => {
  it('rejects a missing idToken with 400', async () => {
    const res = await request(app).post('/auth/web3auth').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('rejects a non-string idToken with 400', async () => {
    const res = await request(app).post('/auth/web3auth').send({ idToken: 12345 });
    expect(res.status).toBe(400);
  });

  it('returns 401 without leaking internals when JWT verification fails (bad signature/expired/wrong audience)', async () => {
    jwtVerifyMock.mockRejectedValue(new Error('signature verification failed: some internal jose stack trace detail'));
    const res = await request(app).post('/auth/web3auth').send({ idToken: 'bad.token.here' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid or expired social login token.');
    // must not leak the underlying error message/stack
    expect(JSON.stringify(res.body)).not.toContain('jose stack trace');
  });

  it('returns 401 when the payload has no email claim', async () => {
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: 'user-sub-1', email_verified: true },
    });
    const res = await request(app).post('/auth/web3auth').send({ idToken: 'valid.token' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Social login did not return a verified email.');
  });

  it('returns 401 when email_verified is explicitly false', async () => {
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: 'user-sub-2', email: 'user@example.com', email_verified: false },
    });
    const res = await request(app).post('/auth/web3auth').send({ idToken: 'valid.token' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Social login did not return a verified email.');
  });

  it('accepts a valid token with email + email_verified: true, returning { email, providerSub }', async () => {
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: 'user-sub-3', email: 'verified@example.com', email_verified: true },
    });
    const res = await request(app).post('/auth/web3auth').send({ idToken: 'valid.token' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ email: 'verified@example.com', providerSub: 'user-sub-3' });
  });

  it('treats an absent email_verified field as verified (some email/passwordless providers never set it)', async () => {
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: 'user-sub-4', email: 'nofield@example.com' },
    });
    const res = await request(app).post('/auth/web3auth').send({ idToken: 'valid.token' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ email: 'nofield@example.com', providerSub: 'user-sub-4' });
  });

  it('maps the sub claim to providerSub in the response', async () => {
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: 'stable-verifier-id-xyz', email: 'sub@example.com', email_verified: true },
    });
    const res = await request(app).post('/auth/web3auth').send({ idToken: 'valid.token' });
    expect(res.status).toBe(200);
    expect(res.body.providerSub).toBe('stable-verifier-id-xyz');
  });

  it('omits providerSub when sub is not a string', async () => {
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: 12345, email: 'nosub@example.com', email_verified: true },
    });
    const res = await request(app).post('/auth/web3auth').send({ idToken: 'valid.token' });
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('nosub@example.com');
    expect(res.body.providerSub).toBeUndefined();
  });
});
