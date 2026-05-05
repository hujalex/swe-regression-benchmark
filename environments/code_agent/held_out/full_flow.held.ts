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
});
