const request = require('supertest');
const { createApp } = require('../src/app');

describe('email logo assets', () => {
  test('serves the circular logo from /email', async () => {
    const app = createApp({ corsOrigins: ['http://localhost:5173'] });
    const response = await request(app).get('/email/logo-circle@2x.png');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/image\/png/);
  });
});
