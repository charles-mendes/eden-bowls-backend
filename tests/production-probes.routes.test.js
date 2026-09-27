const request = require('supertest');
const { createApp } = require('../src/app');

describe('production probes', () => {
  test('health and liveness stay up without querying MySQL', async () => {
    const dataSource = { query: jest.fn() };
    const app = createApp({ dataSource });

    const health = await request(app).get('/health');
    const liveness = await request(app).get('/liveness');

    expect(health.status).toBe(200);
    expect(health.body).toEqual({ status: 'ok' });
    expect(liveness.status).toBe(200);
    expect(liveness.body).toEqual({ status: 'alive' });
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  test('readiness returns ready after SELECT 1', async () => {
    const dataSource = { query: jest.fn().mockResolvedValue([{ 1: 1 }]) };
    const app = createApp({ dataSource });
    const response = await request(app).get('/readiness');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ready' });
    expect(dataSource.query).toHaveBeenCalledWith('SELECT 1');
  });

  test('readiness hides driver errors', async () => {
    const dataSource = {
      query: jest.fn().mockRejectedValue(new Error('Access denied for user root'))
    };
    const app = createApp({ dataSource, logger: { error: jest.fn() } });
    const response = await request(app).get('/readiness');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: 'not_ready' });
    expect(JSON.stringify(response.body)).not.toContain('Access denied');
  });

  test('readiness is not ready when the data source is missing', async () => {
    const app = createApp({});
    const response = await request(app).get('/readiness');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: 'not_ready' });
  });

  test('metrics returns Prometheus text for the correct token', async () => {
    const app = createApp({ nodeEnv: 'production', metricsToken: 'secret-token' });
    const response = await request(app).get('/metrics').set('Authorization', 'Bearer secret-token');

    expect(response.status).toBe(200);
    expect(response.text).toContain('nodejs_');
  });

  test('metrics returns 404 when the token is missing', async () => {
    const app = createApp({ nodeEnv: 'production', metricsToken: 'secret-token' });
    const response = await request(app).get('/metrics');

    expect(response.status).toBe(404);
    expect(response.text).toBe('');
  });

  test('metrics returns 404 for a wrong token', async () => {
    const app = createApp({ nodeEnv: 'production', metricsToken: 'secret-token' });
    const response = await request(app).get('/metrics').set('Authorization', 'Bearer wrong-token');

    expect(response.status).toBe(404);
    expect(response.text).toBe('');
  });

  test('metrics returns 404 for a shorter token', async () => {
    const app = createApp({ nodeEnv: 'production', metricsToken: 'secret-token' });
    const response = await request(app).get('/metrics').set('Authorization', 'Bearer short');

    expect(response.status).toBe(404);
    expect(response.text).toBe('');
  });

  test('metrics stays open outside production', async () => {
    const app = createApp({ nodeEnv: 'development' });
    const response = await request(app).get('/metrics');

    expect(response.status).toBe(200);
    expect(response.text.length).toBeGreaterThan(0);
  });
});
