import request from 'supertest';
import { app } from '../../src/index';

describe('held-out: POST /login rate limit (general behavior)', () => {
  it('attempts 6..10 are all 429 (limiter does not reset mid-window)', async () => {
    const creds = { email: 'rl-held@example.com', password: 'wrong' };
    const codes: number[] = [];
    for (let i = 0; i < 10; i++) {
      const res = await request(app).post('/login').send(creds);
      codes.push(res.status);
    }
    for (let i = 5; i < 10; i++) {
      expect(codes[i]).toBe(429);
    }
  });

  it('first 5 attempts are NOT 429 (limiter does not trigger too early)', async () => {
    const creds = { email: 'rl-early@example.com', password: 'wrong' };
    for (let i = 0; i < 5; i++) {
      const res = await request(app).post('/login').send(creds);
      expect(res.status).not.toBe(429);
    }
    // 6th must be 429
    const sixth = await request(app).post('/login').send(creds);
    expect(sixth.status).toBe(429);
  });

  it('limiter response carries an error body, not generic 401', async () => {
    const creds = { email: 'rl-body@example.com', password: 'wrong' };
    let limited;
    for (let i = 0; i < 8; i++) {
      const res = await request(app).post('/login').send(creds);
      if (res.status === 429) {
        limited = res;
        break;
      }
    }
    expect(limited).toBeDefined();
    expect(limited!.body).toHaveProperty('error');
  });

  it('rate limit is per-client: a different email+IP does not inherit the counter', async () => {
    // Exhaust the limit for one identity
    const credsA = { email: 'rl-a@example.com', password: 'wrong' };
    for (let i = 0; i < 6; i++) {
      await request(app).post('/login').send(credsA);
    }
    // A different email on the same "IP" still gets fresh attempts (or its own bucket).
    // The point: the limiter must not be a global counter that blocks everyone.
    const credsB = { email: 'rl-b@example.com', password: 'wrong' };
    const first = await request(app).post('/login').send(credsB);
    expect(first.status).not.toBe(429);
  });
});
