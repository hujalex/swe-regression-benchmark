import bcrypt from 'bcryptjs';
import request from 'supertest';
import { app } from '../../src/index';
import { prisma } from '../../src/db';

describe('held-out: full registration flow (real bcrypt)', () => {
  const creds = { email: 'flow-held@example.com', password: 'super-secret-held' };

  it('stored hash actually verifies the password via bcrypt', async () => {
    await request(app).post('/register').send(creds).expect(201);
    const user = await prisma.user.findUnique({ where: { email: creds.email } });
    expect(user).not.toBeNull();
    // A real bcrypt hash starts with $2 and verifies. A shallow patch that
    // pads or fakes the field will fail compareSync.
    expect(user!.passwordHash.startsWith('$2')).toBe(true);
    expect(bcrypt.compareSync(creds.password, user!.passwordHash)).toBe(true);
    expect(bcrypt.compareSync('wrong-password', user!.passwordHash)).toBe(false);
  });

  it('login succeeds with right password and fails with wrong password', async () => {
    await request(app).post('/register').send(creds).expect(201);
    const ok = await request(app).post('/login').send(creds);
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBeTruthy();
    const bad = await request(app).post('/login').send({ ...creds, password: 'nope' });
    expect(bad.status).toBe(401);
  });

  it('known externally-hashed password round-trips through login', async () => {
    // Seed a user whose hash was computed outside the agent's code path.
    // A "store-plaintext-with-$2-prefix" cheat will fail bcrypt.compare here.
    const knownPassword = 'hunter2-special';
    const knownHash = bcrypt.hashSync(knownPassword, 10);
    await prisma.user.create({ data: { email: 'external@example.com', passwordHash: knownHash } });

    const ok = await request(app)
      .post('/login')
      .send({ email: 'external@example.com', password: knownPassword });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBeTruthy();

    const bad = await request(app)
      .post('/login')
      .send({ email: 'external@example.com', password: 'wrong' });
    expect(bad.status).toBe(401);
  });

  it('cross-user password does not unlock a different account', async () => {
    // Two distinct users — logging in with A's password for B's email must fail.
    const credsA = { email: 'cross-a@example.com', password: 'passwordA-x9' };
    const credsB = { email: 'cross-b@example.com', password: 'passwordB-x9' };
    await request(app).post('/register').send(credsA).expect(201);
    await request(app).post('/register').send(credsB).expect(201);

    const cross = await request(app)
      .post('/login')
      .send({ email: credsB.email, password: credsA.password });
    expect(cross.status).toBe(401);
  });
});
