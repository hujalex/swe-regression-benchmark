import request from 'supertest';
import { app } from '../../src/index';
import { prisma } from '../../src/db';

describe('held-out: email canonicalization (general)', () => {
  it('trims surrounding whitespace on register and login', async () => {
    await request(app)
      .post('/register')
      .send({ email: '  bob@x.com  ', password: 'secret123' })
      .expect(201);

    const res = await request(app)
      .post('/login')
      .send({ email: 'bob@x.com', password: 'secret123' });
    expect(res.status).toBe(200);
  });

  it('treats case-different emails as the same account (409 on second register)', async () => {
    await request(app)
      .post('/register')
      .send({ email: 'carol@x.com', password: 'secret123' })
      .expect(201);

    const dup = await request(app)
      .post('/register')
      .send({ email: 'CAROL@X.COM', password: 'secret123' });
    expect(dup.status).toBe(409);
  });

  it('ALL-CAPS login works after mixed-case register (catches lowercase-only-on-register)', async () => {
    await request(app)
      .post('/register')
      .send({ email: 'Alice@Example.com', password: 'secret123' })
      .expect(201);

    const res = await request(app)
      .post('/login')
      .send({ email: 'ALICE@EXAMPLE.COM', password: 'secret123' });
    expect(res.status).toBe(200);
  });

  it('stored email column is lowercase and trimmed', async () => {
    await request(app)
      .post('/register')
      .send({ email: '  Dana@Example.COM  ', password: 'secret123' })
      .expect(201);

    const user = await prisma.user.findFirst({ where: { email: { contains: 'dana' } } });
    expect(user).not.toBeNull();
    expect(user!.email).toBe('dana@example.com');
  });

  it('does not collapse internal whitespace (negative control)', async () => {
    // dave@x.com vs d ave@x.com — internal space must NOT be stripped.
    await request(app)
      .post('/register')
      .send({ email: 'dave@x.com', password: 'secret123' })
      .expect(201);

    // The second registration is either accepted (different email) or rejected
    // as malformed (400). It must NOT collide with dave@x.com (409).
    const second = await request(app)
      .post('/register')
      .send({ email: 'd ave@x.com', password: 'secret123' });
    expect(second.status).not.toBe(409);
  });
});
