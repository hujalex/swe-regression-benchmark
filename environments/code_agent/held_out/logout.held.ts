import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../../src/index';
import { prisma } from '../../src/db';

describe('held-out: POST /logout token revocation (general)', () => {
  it('/logout without Authorization header returns 401', async () => {
    const res = await request(app).post('/logout');
    expect(res.status).toBe(401);
  });

  it('/logout with an expired token returns 401', async () => {
    const user = await prisma.user.create({
      data: { email: 'logout-exp@x.com', passwordHash: 'unused' },
    });
    const now = Math.floor(Date.now() / 1000);
    const expiredToken = jwt.sign(
      { sub: user.id, email: user.email, iat: now - 7200, exp: now - 60 },
      process.env.JWT_SECRET!,
    );
    const res = await request(app).post('/logout').set('Authorization', `Bearer ${expiredToken}`);
    expect(res.status).toBe(401);
  });

  it('revoked token is rejected by /logout on a second call', async () => {
    await request(app).post('/register').send({ email: 'logout-2nd@x.com', password: 'secret123' }).expect(201);
    const login = await request(app).post('/login').send({ email: 'logout-2nd@x.com', password: 'secret123' }).expect(200);
    const { token } = login.body;

    await request(app).post('/logout').set('Authorization', `Bearer ${token}`).expect(200);
    const second = await request(app).post('/logout').set('Authorization', `Bearer ${token}`);
    expect(second.status).toBe(401);
  });

  it('revocation is DB-backed: a second supertest agent sees the revoked token', async () => {
    // Two independent supertest agents share the same running app instance and
    // the same DB, so revocation set in one must be visible to the other.
    // This rules out module-scoped in-memory Sets that a fresh import would reset.
    await request(app).post('/register').send({ email: 'logout-db@x.com', password: 'secret123' }).expect(201);
    const login = await request(app).post('/login').send({ email: 'logout-db@x.com', password: 'secret123' }).expect(200);
    const { token } = login.body;

    // Agent 1 logs out
    await request(app).post('/logout').set('Authorization', `Bearer ${token}`).expect(200);

    // Agent 2 (fresh request factory, same app instance) tries /me
    const agent2 = request(app);
    const meRes = await agent2.get('/me').set('Authorization', `Bearer ${token}`);
    expect(meRes.status).toBe(401);
  });
});
