import request from 'supertest';
import { app } from '../../src/index';

async function registerAndLogin(email: string) {
  await request(app).post('/register').send({ email, password: 'secret123' });
  const res = await request(app).post('/login').send({ email, password: 'secret123' });
  return res.body.token as string;
}

describe('held-out: GET /orders/:id IDOR prevention (general)', () => {
  it('non-existent order returns 404 with same body shape as cross-user case', async () => {
    const token = await registerAndLogin('idor-noexist@x.com');
    const res = await request(app)
      .get('/orders/99999')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('cross-user 404 and non-existent 404 return identical response bodies (no existence leak)', async () => {
    const tokenA = await registerAndLogin('idor-leak-a@x.com');
    const tokenB = await registerAndLogin('idor-leak-b@x.com');

    const create = await request(app)
      .post('/orders')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ total: 777 })
      .expect(201);
    const orderId = create.body.id;

    const crossUser = await request(app)
      .get(`/orders/${orderId}`)
      .set('Authorization', `Bearer ${tokenB}`);
    const noExist = await request(app)
      .get('/orders/99999')
      .set('Authorization', `Bearer ${tokenB}`);

    expect(crossUser.status).toBe(404);
    expect(noExist.status).toBe(404);
    expect(JSON.stringify(crossUser.body)).toBe(JSON.stringify(noExist.body));
  });

  it('owner can still fetch own order (positive control)', async () => {
    const token = await registerAndLogin('idor-owner@x.com');
    const create = await request(app)
      .post('/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ total: 1234 })
      .expect(201);

    const res = await request(app)
      .get(`/orders/${create.body.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1234);
    expect(res.body.id).toBe(create.body.id);
  });

  it('POST /orders ignores attacker-supplied userId (no mass-assign)', async () => {
    const tokenA = await registerAndLogin('idor-massA@x.com');
    const tokenB = await registerAndLogin('idor-massB@x.com');

    // B tries to create an order specifying A's userId in the body
    const loginA = await request(app).post('/login').send({ email: 'idor-massA@x.com', password: 'secret123' });
    const idA = (loginA.body.token
      ? JSON.parse(Buffer.from(loginA.body.token.split('.')[1], 'base64').toString()).sub
      : null) as number | null;

    const create = await request(app)
      .post('/orders')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ total: 50, userId: idA });
    expect(create.status).toBe(201);

    // The order must be owned by B, not A
    const order = await request(app)
      .get(`/orders/${create.body.id}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(order.status).toBe(200);

    // A should NOT be able to access B's order
    const crossFetch = await request(app)
      .get(`/orders/${create.body.id}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(crossFetch.status).toBe(404);
  });
});
