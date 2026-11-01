const request = require('supertest');
const { createApp } = require('../src/app');
const { ROLE_PERMISSIONS } = require('../src/core/admin-roles');
const { issueJwtToken } = require('../src/core/jwt-token');
const { BlingNfeService } = require('../src/services/bling-nfe.service');

const jwt = { secret: 'test-secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };

function appFor(role, blingNfeService) {
  return createApp({
    corsOrigins: ['http://localhost:5174'],
    jwt,
    adminIdentityService: {
      requireOperational: async () => ({ id: 1, roles: [role], permissions: ROLE_PERMISSIONS[role], markets: ['BR'] })
    },
    blingNfeService
  });
}

function bearer() {
  const token = issueJwtToken({ data: { user: { id: 7 } } }, { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) });
  return `Bearer ${token}`;
}

describe('admin NF-e routes', () => {
  const service = () => ({
    list: jest.fn(async () => ({ success: true, data: { items: [] } })),
    retry: jest.fn(async () => ({ success: true, data: { id: 1 } }))
  });

  test.each(['admin', 'operator', 'readonly'])('%s lists', async (role) => {
    const blingNfeService = service();
    const response = await request(appFor(role, blingNfeService)).get('/api/v1/admin/nfe?status=error').set('Authorization', bearer());
    expect(response.status).toBe(200);
    expect(blingNfeService.list).toHaveBeenCalled();
  });

  test('readonly sees but does not retry', async () => {
    const blingNfeService = service();
    const response = await request(appFor('readonly', blingNfeService)).post('/api/v1/admin/nfe/1/retry').set('Authorization', bearer());
    expect(response.status).toBe(403);
    expect(blingNfeService.retry).not.toHaveBeenCalled();
  });

  test.each(['admin', 'operator'])('%s retries', async (role) => {
    const blingNfeService = service();
    const response = await request(appFor(role, blingNfeService)).post('/api/v1/admin/nfe/1/retry').set('Authorization', bearer());
    expect(response.status).toBe(200);
  });

  test('the veterinarian has no access', async () => {
    const response = await request(appFor('veterinarian', service())).get('/api/v1/admin/nfe').set('Authorization', bearer());
    expect(response.status).toBe(403);
  });
});

describe('Bling OAuth callback', () => {
  function oauthService({ stateOk = true, exchange = async () => {} } = {}) {
    const client = {
      isConfigured: () => true,
      consumeState: jest.fn(async () => stateOk),
      exchangeCode: jest.fn(exchange)
    };
    return {
      client,
      service: new BlingNfeService({ repository: {}, client, naturezaOperacaoId: 9, adminAppUrl: 'https://admin', logger: { error() {} } })
    };
  }
  const get = (service, query) => request(createApp({ corsOrigins: [], jwt, blingNfeService: service }))
    .get(`/api/v1/bling/oauth/callback${query}`);

  test('needs no login and trades the code after the state matches', async () => {
    const { service, client } = oauthService();
    const response = await get(service, '?code=c1&state=s1');
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('https://admin/operations/nfe?bling=connected');
    expect(client.exchangeCode).toHaveBeenCalledWith('c1');
  });

  test('a wrong state never trades the code', async () => {
    const { service, client } = oauthService({ stateOk: false });
    const response = await get(service, '?code=c1&state=bad');
    expect(response.headers.location).toContain('bling=invalid');
    expect(client.exchangeCode).not.toHaveBeenCalled();
  });

  test('a failed exchange shows nothing of Bling in the redirect', async () => {
    const { service } = oauthService({ exchange: async () => { throw new Error('secret detail'); } });
    const response = await get(service, '?code=c1&state=s1');
    expect(response.headers.location).toBe('https://admin/operations/nfe?bling=failed');
  });
});
