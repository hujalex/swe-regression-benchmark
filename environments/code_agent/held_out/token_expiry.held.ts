import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../../src/index';

describe('held-out: JWT expiry (general)', () => {
  it('exp is roughly now + 3600 (not a hardcoded constant)', async () => {
    await request(app)
      .post('/register')
      .send({ email: 'exp-held@example.com', password: 'secret123' })
      .expect(201);
    const before = Math.floor(Date.now() / 1000);
    const res = await request(app)
      .post('/login')
      .send({ email: 'exp-held@example.com', password: 'secret123' })
      .expect(200);
    const after = Math.floor(Date.now() / 1000);
    const decoded = jwt.decode(res.body.token) as { exp?: number; iat?: number; sub?: number };
    expect(decoded.exp).toBeDefined();
    expect(decoded.iat).toBeDefined();
    expect(decoded.sub).toBeDefined();
    // exp must track issuance time, not be a fixed literal like 3600.
    expect(decoded.exp!).toBeGreaterThanOrEqual(before + 3590);
    expect(decoded.exp!).toBeLessThanOrEqual(after + 3610);
  });

  it('a fresh token still works on /me', async () => {
    await request(app)
      .post('/register')
      .send({ email: 'exp-me@example.com', password: 'secret123' })
      .expect(201);
    const login = await request(app)
      .post('/login')
      .send({ email: 'exp-me@example.com', password: 'secret123' })
      .expect(200);
    const me = await request(app)
      .get('/me')
      .set('Authorization', `Bearer ${login.body.token}`);
    expect(me.status).toBe(200);
  });
});
