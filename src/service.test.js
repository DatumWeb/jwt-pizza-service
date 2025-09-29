const request = require('supertest');
const app = require('./service');

test('root and docs and 404', async () => {
  const rootResponse = await request(app).get('/');
  expect(rootResponse.status).toBe(200);
  expect(rootResponse.body).toHaveProperty('version');

  const docsResponse = await request(app).get('/api/docs');
  expect(docsResponse.status).toBe(200);
  expect(docsResponse.body).toHaveProperty('endpoints');
  expect(Array.isArray(docsResponse.body.endpoints)).toBe(true);

  const notFoundResponse = await request(app).get('/nope');
  expect(notFoundResponse.status).toBe(404);
});


