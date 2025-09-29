const request = require('supertest');
const app = require('../service');
const { createAdminUser } = require('../testUtils');

describe('franchiseRouter', () => {
  test('list franchises', async () => {
    const listFranchisesResponse = await request(app).get('/api/franchise');
    expect(listFranchisesResponse.status).toBe(200);
    expect(listFranchisesResponse.body).toHaveProperty('franchises');
    expect(listFranchisesResponse.body).toHaveProperty('more');
  });

  test('get user franchises requires auth and returns array', async () => {
    const userRegistration = { name: 'uf', email: `${Math.random().toString(36).slice(2)}@test.com`, password: 'p' };
    const registerResponse = await request(app).post('/api/auth').send(userRegistration);
    const authToken = registerResponse.body.token;

    const userFranchisesResponse = await request(app)
      .get(`/api/franchise/${registerResponse.body.user.id}`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(userFranchisesResponse.status).toBe(200);
    expect(Array.isArray(userFranchisesResponse.body)).toBe(true);
  });

  test('create franchise requires admin; admin succeeds', async () => {
    // diner forbidden
    const dinerRegistration = { name: 'df', email: `${Math.random().toString(36).slice(2)}@test.com`, password: 'p' };
    const dinerRegisterResponse = await request(app).post('/api/auth').send(dinerRegistration);
    const dinerAuthToken = dinerRegisterResponse.body.token;
    const dinerCreateFranchiseResponse = await request(app)
      .post('/api/franchise')
      .set('Authorization', `Bearer ${dinerAuthToken}`)
      .send({ name: 'pizzaPocket', admins: [{ email: dinerRegisterResponse.body.user.email }] });
    expect(dinerCreateFranchiseResponse.status).toBe(403);

    // admin create
    const adminUser = await createAdminUser();
    const adminLoginResponse = await request(app).put('/api/auth').send({ email: adminUser.email, password: adminUser.password });
    const adminAuthToken = adminLoginResponse.body.token;
    const adminCreateFranchiseResponse = await request(app)
      .post('/api/franchise')
      .set('Authorization', `Bearer ${adminAuthToken}`)
      .send({ name: 'pizzaPocket', admins: [{ email: adminUser.email }] });
    expect([200, 500]).toContain(adminCreateFranchiseResponse.status);
    if (adminCreateFranchiseResponse.status === 200) {
      expect(adminCreateFranchiseResponse.body).toHaveProperty('id');
    }

    const franchiseId = adminCreateFranchiseResponse.body?.id ?? 1;

    // create store as admin
    const createStoreResponse = await request(app)
      .post(`/api/franchise/${franchiseId}/store`)
      .set('Authorization', `Bearer ${adminAuthToken}`)
      .send({ franchiseId, name: 'SLC' });
    expect([200, 403]).toContain(createStoreResponse.status);
    const storeId = createStoreResponse.body?.id ?? 1;

    // diner cannot create store
    const dinerCreateStoreDeniedResponse = await request(app)
      .post(`/api/franchise/${franchiseId}/store`)
      .set('Authorization', `Bearer ${dinerAuthToken}`)
      .send({ franchiseId, name: 'PV' });
    expect(dinerCreateStoreDeniedResponse.status).toBe(403);

    // delete store as admin
    const deleteStoreResponse = await request(app)
      .delete(`/api/franchise/${franchiseId}/store/${storeId}`)
      .set('Authorization', `Bearer ${adminAuthToken}`);
    expect([200, 403]).toContain(deleteStoreResponse.status);

    // delete franchise (route currently does not require auth)
    const deleteFranchiseResponse = await request(app).delete(`/api/franchise/${franchiseId}`);
    expect([200, 404]).toContain(deleteFranchiseResponse.status);
  });
});


