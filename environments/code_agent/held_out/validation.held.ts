import request from 'supertest';
import { app } from '../../src/index';

describe('held-out: POST /register validation (additional cases)', () => {
  it('rejects an empty body', async () => {
    const res = await request(app).post('/register').send({});
    expect(res.status).toBe(400);
  });

  it('rejects an empty-string password', async () => {
    const res = await request(app).post('/register').send({ email: 'a@b.com', password: '' });
    expect(res.status).toBe(400);
  });

  it('rejects a non-string email', async () => {
    const res = await request(app).post('/register').send({ email: 12345, password: 'secret' });
    expect(res.status).toBe(400);
  });

  it('rejects a non-string password', async () => {
    const res = await request(app).post('/register').send({ email: 'a@b.com', password: 12345 });
    expect(res.status).toBe(400);
  });

  it('accepts a valid body (positive control)', async () => {
    const res = await request(app)
      .post('/register')
      .send({ email: 'valid-held@example.com', password: 'goodpassword' });
    expect(res.status).toBe(201);
  });
});
