const request = require('supertest');
const app = require('../service');

describe('authRouter edge cases', () => {
  test('register missing fields returns 400', async () => {
    const emptyBodyResponse = await request(app).post('/api/auth').send({});
    expect(emptyBodyResponse.status).toBe(400);
    const missingPasswordResponse = await request(app).post('/api/auth').send({ name: 'x', email: 'a@test.com' });
    expect(missingPasswordResponse.status).toBe(400);
  });

  test('logout unauthorized without token', async () => {
    const logoutNoTokenResponse = await request(app).delete('/api/auth');
    expect(logoutNoTokenResponse.status).toBe(401);
  });

  test('logout succeeds with token', async () => {
    const userRegistration = { name: 'lo', email: `${Math.random().toString(36).slice(2)}@test.com`, password: 'p' };
    const registerResponse = await request(app).post('/api/auth').send(userRegistration);
    const authToken = registerResponse.body.token;
    const logoutResponse = await request(app).delete('/api/auth').set('Authorization', `Bearer ${authToken}`);
    expect(logoutResponse.status).toBe(200);
    expect(logoutResponse.body).toHaveProperty('message');
  });
});


