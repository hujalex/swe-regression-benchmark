import request from 'supertest';
import { app } from '../../src/index';
import { prisma } from '../../src/db';

describe('held-out: POST /register race safety (general)', () => {
  it('10 parallel registrations → exactly 1×201, 9×409, 0×5xx, 1 DB row', async () => {
    const body = { email: 'burst10@x.com', password: 'secret123' };
    const results = await Promise.all(
      Array.from({ length: 10 }, () => request(app).post('/register').send(body)),
    );
    const statuses = results.map(r => r.status);
    const created = statuses.filter(s => s === 201).length;
    const conflict = statuses.filter(s => s === 409).length;
    const errors = statuses.filter(s => s >= 500).length;

    expect(created).toBe(1);
    expect(conflict).toBe(9);
    expect(errors).toBe(0);

    const count = await prisma.user.count({ where: { email: 'burst10@x.com' } });
    expect(count).toBe(1);
  });

  it('parallel registrations for different emails both succeed', async () => {
    const [r1, r2] = await Promise.all([
      request(app).post('/register').send({ email: 'par-a@x.com', password: 'secret123' }),
      request(app).post('/register').send({ email: 'par-b@x.com', password: 'secret123' }),
    ]);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
  });

  it('5 parallel same-email + 1 different email — different email always succeeds', async () => {
    const sameBody = { email: 'same5@x.com', password: 'secret123' };
    const diffBody = { email: 'different5@x.com', password: 'secret123' };
    const results = await Promise.all([
      ...Array.from({ length: 5 }, () => request(app).post('/register').send(sameBody)),
      request(app).post('/register').send(diffBody),
    ]);
    const diffResult = results[results.length - 1];
    expect(diffResult.status).toBe(201);

    const sameStatuses = results.slice(0, 5).map(r => r.status);
    expect(sameStatuses.filter(s => s >= 500)).toHaveLength(0);
    expect(sameStatuses.filter(s => s === 201)).toHaveLength(1);
  });
});
