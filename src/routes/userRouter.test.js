const request = require('supertest');
const app = require('../service');
const { createAdminUser } = require('../testUtils');

describe('userRouter', () => {
  test('me returns authenticated user', async () => {
    const newUserRegistration = { name: 'me user', email: `${Math.random().toString(36).slice(2)}@test.com`, password: 'p' };
    const registerResponse = await request(app).post('/api/auth').send(newUserRegistration);
    const authToken = registerResponse.body.token;

    const meResponse = await request(app).get('/api/user/me').set('Authorization', `Bearer ${authToken}`);
    expect(meResponse.status).toBe(200);
    expect(meResponse.body.email).toBe(newUserRegistration.email);
  });

  test('self update succeeds, others update requires admin', async () => {
    // create a normal user
    const normalUserRegistration = { name: 'norm', email: `${Math.random().toString(36).slice(2)}@test.com`, password: 'pw' };
    const normalRegisterResponse = await request(app).post('/api/auth').send(normalUserRegistration);
    const normalAuthToken = normalRegisterResponse.body.token;
    const normalUserId = normalRegisterResponse.body.user.id;

    // self update
    const updatedName = 'updated name';
    const selfUpdateResponse = await request(app)
      .put(`/api/user/${normalUserId}`)
      .set('Authorization', `Bearer ${normalAuthToken}`)
      .send({ name: updatedName, email: normalUserRegistration.email, password: normalUserRegistration.password });
    expect(selfUpdateResponse.status).toBe(200);
    expect(selfUpdateResponse.body.user.name).toBe(updatedName);
    expect(typeof selfUpdateResponse.body.token).toBe('string');

    // create another user
    const otherUserRegistration = { name: 'other', email: `${Math.random().toString(36).slice(2)}@test.com`, password: 'pw' };
    const otherRegisterResponse = await request(app).post('/api/auth').send(otherUserRegistration);
    const otherUserId = otherRegisterResponse.body.user.id;

    // non-admin cannot update others
    const forbiddenUpdateResponse = await request(app)
      .put(`/api/user/${otherUserId}`)
      .set('Authorization', `Bearer ${normalAuthToken}`)
      .send({ name: 'hack', email: otherUserRegistration.email, password: otherUserRegistration.password });
    expect(forbiddenUpdateResponse.status).toBe(403);

    // admin can update others
    const adminUser = await createAdminUser();
    const adminLoginResponse = await request(app).put('/api/auth').send({ email: adminUser.email, password: adminUser.password });
    const adminAuthToken = adminLoginResponse.body.token;

    const adminUpdateResponse = await request(app)
      .put(`/api/user/${otherUserId}`)
      .set('Authorization', `Bearer ${adminAuthToken}`)
      .send({ name: 'admin set', email: otherUserRegistration.email, password: otherUserRegistration.password });
    expect(adminUpdateResponse.status).toBe(200);
    expect(adminUpdateResponse.body.user.name).toBe('admin set');
  });

  test('list users unauthorized', async () => {
    const listUsersRes = await request(app).get('/api/user');
    expect(listUsersRes.status).toBe(401);
  });

  test('list users', async () => {
    const adminUser = await createAdminUser();
    const adminLoginResponse = await request(app).put('/api/auth').send({ email: adminUser.email, password: adminUser.password });
    const adminAuthToken = adminLoginResponse.body.token;
    
    const listUsersRes = await request(app)
      .get('/api/user')
      .set('Authorization', 'Bearer ' + adminAuthToken);
    expect(listUsersRes.status).toBe(200);
    expect(listUsersRes.body).toHaveProperty('users');
    expect(Array.isArray(listUsersRes.body.users)).toBe(true);
  });

  test('list users with pagination', async () => {
    const adminUser = await createAdminUser();
    const adminLoginResponse = await request(app).put('/api/auth').send({ email: adminUser.email, password: adminUser.password });
    const adminAuthToken = adminLoginResponse.body.token;
    
    const listUsersRes = await request(app)
      .get('/api/user?page=0&limit=5')
      .set('Authorization', 'Bearer ' + adminAuthToken);
    expect(listUsersRes.status).toBe(200);
    expect(listUsersRes.body).toHaveProperty('users');
    expect(listUsersRes.body).toHaveProperty('more');
  });

  test('list users with name filter', async () => {
    const adminUser = await createAdminUser();
    const adminLoginResponse = await request(app).put('/api/auth').send({ email: adminUser.email, password: adminUser.password });
    const adminAuthToken = adminLoginResponse.body.token;
    
    const listUsersRes = await request(app)
      .get('/api/user?name=pizza')
      .set('Authorization', 'Bearer ' + adminAuthToken);
    expect(listUsersRes.status).toBe(200);
    expect(listUsersRes.body).toHaveProperty('users');
  });

  test('list users requires admin role', async () => {
    const [, userToken] = await registerUser(request(app));
    const listUsersRes = await request(app)
      .get('/api/user')
      .set('Authorization', 'Bearer ' + userToken);
    expect(listUsersRes.status).toBe(403);
  });

  test('delete user unauthorized', async () => {
    const deleteUserRes = await request(app).delete('/api/user/1');
    expect(deleteUserRes.status).toBe(401);
  });

  test('delete user requires admin role', async () => {
    const [, userToken] = await registerUser(request(app));
    const deleteUserRes = await request(app)
      .delete('/api/user/1')
      .set('Authorization', 'Bearer ' + userToken);
    expect(deleteUserRes.status).toBe(403);
  });

  test('delete user successfully', async () => {
    // Create a user to delete
    const [userToDelete] = await registerUser(request(app));
    const userIdToDelete = userToDelete.id;
    
    // Create admin user
    const adminUser = await createAdminUser();
    const adminLoginResponse = await request(app).put('/api/auth').send({ email: adminUser.email, password: adminUser.password });
    const adminAuthToken = adminLoginResponse.body.token;
    
    // Delete the user
    const deleteUserRes = await request(app)
      .delete(`/api/user/${userIdToDelete}`)
      .set('Authorization', 'Bearer ' + adminAuthToken);
    expect(deleteUserRes.status).toBe(200);
  });

  test('delete non-existent user', async () => {
    const adminUser = await createAdminUser();
    const adminLoginResponse = await request(app).put('/api/auth').send({ email: adminUser.email, password: adminUser.password });
    const adminAuthToken = adminLoginResponse.body.token;
    
    const deleteUserRes = await request(app)
      .delete('/api/user/99999')
      .set('Authorization', 'Bearer ' + adminAuthToken);
    expect(deleteUserRes.status).toBe(404);
  });

  async function registerUser(service) {
    const testUser = {
      name: 'pizza diner',
      email: `${randomName()}@test.com`,
      password: 'a',
    };
    const registerRes = await service.post('/api/auth').send(testUser);
    registerRes.body.user.password = testUser.password;

    return [registerRes.body.user, registerRes.body.token];
  }

  function randomName() {
    return Math.random().toString(36).substring(2, 12);
  }
});


