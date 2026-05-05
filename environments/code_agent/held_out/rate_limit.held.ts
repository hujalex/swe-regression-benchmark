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
});
