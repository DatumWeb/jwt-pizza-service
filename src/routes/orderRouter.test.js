const request = require('supertest');
const app = require('../service');
const { createAdminUser } = require('../testUtils');

describe('orderRouter', () => {
  test('menu get returns items', async () => {
    const menuResponse = await request(app).get('/api/order/menu');
    expect(menuResponse.status).toBe(200);
    expect(Array.isArray(menuResponse.body)).toBe(true);
  });

  test('add menu requires admin, then succeeds', async () => {
    // diner cannot add
    const dinerRegistration = { name: 'd', email: `${Math.random().toString(36).slice(2)}@test.com`, password: 'p' };
    const dinerRegisterResponse = await request(app).post('/api/auth').send(dinerRegistration);
    const dinerAuthToken = dinerRegisterResponse.body.token;

    const addMenuForbiddenResponse = await request(app)
      .put('/api/order/menu')
      .set('Authorization', `Bearer ${dinerAuthToken}`)
      .send({ title: 'Student', description: 'cheap', image: 'pizza9.png', price: 0.0001 });
    expect(addMenuForbiddenResponse.status).toBe(403);

    // admin succeeds
    const adminUser = await createAdminUser();
    const adminLoginResponse = await request(app).put('/api/auth').send({ email: adminUser.email, password: adminUser.password });
    const adminAuthToken = adminLoginResponse.body.token;
    const addMenuOkResponse = await request(app)
      .put('/api/order/menu')
      .set('Authorization', `Bearer ${adminAuthToken}`)
      .send({ title: 'Student', description: 'cheap', image: 'pizza9.png', price: 0.0001 });
    expect(addMenuOkResponse.status).toBe(200);
    expect(Array.isArray(addMenuOkResponse.body)).toBe(true);
  });

  test('get orders and create order; factory success and failure', async () => {
    const dinerRegistration = { name: 'o', email: `${Math.random().toString(36).slice(2)}@test.com`, password: 'p' };
    const registerResponse = await request(app).post('/api/auth').send(dinerRegistration);
    const dinerAuthToken = registerResponse.body.token;

    const ordersListResponse = await request(app).get('/api/order').set('Authorization', `Bearer ${dinerAuthToken}`);
    expect(ordersListResponse.status).toBe(200);
    expect(ordersListResponse.body).toHaveProperty('orders');

    // mock factory success
    const originalFetch = global.fetch;
    global.fetch = async () => ({ ok: true, json: async () => ({ jwt: 'x', reportUrl: 'http://r' }) });
    const createOrderSuccessResponse = await request(app)
      .post('/api/order')
      .set('Authorization', `Bearer ${dinerAuthToken}`)
      .send({ franchiseId: 1, storeId: 1, items: [{ menuId: 1, description: 'Veggie', price: 0.05 }] });
    expect(createOrderSuccessResponse.status).toBe(200);
    expect(createOrderSuccessResponse.body).toHaveProperty('jwt');

    // mock factory failure
    global.fetch = async () => ({ ok: false, json: async () => ({ reportUrl: 'http://err' }) });
    const createOrderFailureResponse = await request(app)
      .post('/api/order')
      .set('Authorization', `Bearer ${dinerAuthToken}`)
      .send({ franchiseId: 1, storeId: 1, items: [{ menuId: 1, description: 'Veggie', price: 0.05 }] });
    expect(createOrderFailureResponse.status).toBe(500);

    global.fetch = originalFetch;
  });
});


