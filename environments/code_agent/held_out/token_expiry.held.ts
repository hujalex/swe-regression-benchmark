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

  it('exp > iat (token expires in the future, not the past)', async () => {
    await request(app)
      .post('/register')
      .send({ email: 'exp-iat@example.com', password: 'secret123' })
      .expect(201);
    const res = await request(app)
      .post('/login')
      .send({ email: 'exp-iat@example.com', password: 'secret123' })
      .expect(200);
    const decoded = jwt.decode(res.body.token) as { exp?: number; iat?: number };
    expect(decoded.exp!).toBeGreaterThan(decoded.iat!);
    // exp - iat must be approximately 3600, not a hardcoded epoch literal.
    expect(decoded.exp! - decoded.iat!).toBeGreaterThanOrEqual(3590);
    expect(decoded.exp! - decoded.iat!).toBeLessThanOrEqual(3610);
  });

  it('two tokens issued ~2s apart have different iat values (not frozen clock)', async () => {
    await request(app)
      .post('/register')
      .send({ email: 'exp-clock@example.com', password: 'secret123' })
      .expect(201);
    const res1 = await request(app)
      .post('/login')
      .send({ email: 'exp-clock@example.com', password: 'secret123' })
      .expect(200);
    await new Promise(r => setTimeout(r, 1100));
    const res2 = await request(app)
      .post('/login')
      .send({ email: 'exp-clock@example.com', password: 'secret123' })
      .expect(200);
    const d1 = jwt.decode(res1.body.token) as { iat?: number };
    const d2 = jwt.decode(res2.body.token) as { iat?: number };
    // iat must advance with real time, not be a hardcoded 0 or constant.
    expect(d2.iat!).toBeGreaterThan(d1.iat!);
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
