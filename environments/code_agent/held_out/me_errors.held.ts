import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../../src/index';
import { prisma } from '../../src/db';

describe('held-out: /me structured error envelope (general)', () => {
  it('expired JWT returns code: expired_token (not invalid_token)', async () => {
    const user = await prisma.user.create({
      data: { email: 'exp-held@x.com', passwordHash: 'unused' },
    });
    const now = Math.floor(Date.now() / 1000);
    const token = jwt.sign(
      { sub: user.id, email: user.email, iat: now - 7200, exp: now - 60 },
      process.env.JWT_SECRET!,
    );

    const res = await request(app).get('/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe('expired_token');
  });

  it('wrong-scheme header does not crash (no 500); returns 401 with a known code', async () => {
    const res = await request(app).get('/me').set('Authorization', 'Token abc');
    expect(res.status).toBe(401);
    expect(['missing_token', 'invalid_token']).toContain(res.body.error?.code);
  });

  it('wrong-scheme error response includes a structured envelope (not just a status)', async () => {
    const res = await request(app).get('/me').set('Authorization', 'Token abc');
    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
    expect(typeof res.body.error.code).toBe('string');
    expect(typeof res.body.error.message).toBe('string');
    expect(res.body.error.message.length).toBeGreaterThan(0);
  });

  it('missing-header error has non-empty code and message strings', async () => {
    const res = await request(app).get('/me');
    expect(res.status).toBe(401);
    expect(typeof res.body.error?.code).toBe('string');
    expect(typeof res.body.error?.message).toBe('string');
    expect(res.body.error.code.length).toBeGreaterThan(0);
    expect(res.body.error.message.length).toBeGreaterThan(0);
  });

  it('valid token still returns 200 with id+email (positive control)', async () => {
    await request(app)
      .post('/register')
      .send({ email: 'me-valid@x.com', password: 'secret123' })
      .expect(201);
    const login = await request(app)
      .post('/login')
      .send({ email: 'me-valid@x.com', password: 'secret123' })
      .expect(200);

    const res = await request(app)
      .get('/me')
      .set('Authorization', `Bearer ${login.body.token}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('me-valid@x.com');
    expect(typeof res.body.id).toBe('number');
  });

  it('all error branches use status 401 (not 400/403/500)', async () => {
    const noHeader = await request(app).get('/me');
    expect(noHeader.status).toBe(401);
    const bad = await request(app).get('/me').set('Authorization', 'Bearer garbage');
    expect(bad.status).toBe(401);
  });
});
