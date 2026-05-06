import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app } from '../../src/index';
import { prisma } from '../../src/db';

describe('held-out: password strength (general)', () => {
  it('rejects 8-char password with no digit (catches "min(8) only" shallow fix)', async () => {
    const res = await request(app)
      .post('/register')
      .send({ email: 'nodigit@x.com', password: 'abcdefgh' });
    expect(res.status).toBe(400);
  });

  it('rejects 7-char password that has a digit (catches "has digit" shallow fix)', async () => {
    const res = await request(app)
      .post('/register')
      .send({ email: 'short1@x.com', password: 'abc1234' });
    expect(res.status).toBe(400);
  });

  it('accepts boundary case: exactly 8 chars with a digit', async () => {
    const res = await request(app)
      .post('/register')
      .send({ email: 'boundary@x.com', password: 'abcdefg1' });
    expect(res.status).toBe(201);
  });

  it('accepts all-digit password of length >= 8 (digit rule is OR-of-chars, not specific char)', async () => {
    const res = await request(app)
      .post('/register')
      .send({ email: 'alldigit@x.com', password: '12345678' });
    expect(res.status).toBe(201);
  });

  it('accepts password whose only digit is "2" (catches password.includes("1") shallow fix)', async () => {
    const res = await request(app)
      .post('/register')
      .send({ email: 'digit2@x.com', password: 'abcdefg2' });
    expect(res.status).toBe(201);
  });

  it('legacy weak-password account can still login (rule is at registration only)', async () => {
    // Seed a user directly with a weak password — bypasses /register so the
    // strength rule cannot reject it. Login must NOT reject this user.
    const passwordHash = await bcrypt.hash('weak', 12);
    await prisma.user.create({ data: { email: 'legacy@x.com', passwordHash } });

    const res = await request(app)
      .post('/login')
      .send({ email: 'legacy@x.com', password: 'weak' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });
});
