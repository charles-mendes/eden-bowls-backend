const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { ROLE_PERMISSIONS } = require('../src/core/admin-roles');
const { marketPermissions } = require('../src/core/admin-market-scope');
const { AdminReportsService } = require('../src/services/admin-reports.service');
const { HttpError } = require('../src/core/http-error');

const jwt = { secret: 'test-secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };

function token() {
  return issueJwtToken(
    { data: { user: { id: 7 } } },
    { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) }
  );
}

function emptyRepository() {
  const zeroInvoices = { revenue: 0, invoices: 0, firstPurchaseRevenue: 0, firstPurchaseInvoices: 0, excludedInvoices: 0 };
  return {
    invoiceTotals: jest.fn().mockResolvedValue(zeroInvoices),
    invoiceSeries: jest.fn().mockResolvedValue([]),
    recurringPrices: jest.fn().mockResolvedValue([]),
    subscriptionSnapshot: jest.fn().mockResolvedValue({ active: 0, trialing: 0, canceling: 0, pastDue: 0, renewing7d: 0 }),
    subscriptionPeriod: jest.fn().mockResolvedValue({ newCount: 0, approximateNew: 0, canceled: 0, approximateCanceled: 0, activeAtStart: 0, churned: 0 }),
    acquisitionTotals: jest.fn().mockResolvedValue({ started: 0, linked: 0, activated: 0 })
  };
}

function reportsApp({ role = 'operator', markets = ['BR'], repository = emptyRepository() } = {}) {
  const adminReportsService = new AdminReportsService({ repository, now: () => new Date('2026-10-28T18:00:00Z') });
  const app = createApp({
    corsOrigins: ['http://localhost:5174'],
    jwt,
    adminIdentityService: {
      requireOperational: jest.fn().mockResolvedValue({
        userId: '7',
        email: 'staff@edenbowls.com',
        roles: [role],
        markets,
        permissions: [...ROLE_PERMISSIONS[role], ...marketPermissions(markets)]
      })
    },
    adminReportsService
  });
  return { app, repository, adminReportsService };
}

const get = (app, path) => request(app).get(path).set('Authorization', `Bearer ${token()}`);

describe('admin reports routes', () => {
  test('readonly reads a report but cannot export it', async () => {
    const { app } = reportsApp({ role: 'readonly' });
    expect((await get(app, '/api/v1/admin/reports/revenue')).status).toBe(200);
    expect((await get(app, '/api/v1/admin/reports/export.csv?report=revenue')).status).toBe(403);
  });

  test('a veterinarian is forbidden', async () => {
    const { app } = reportsApp({ role: 'veterinarian' });
    expect((await get(app, '/api/v1/admin/reports/summary')).status).toBe(403);
  });

  test('an operator BR asking for US is market_forbidden', async () => {
    const { app, repository } = reportsApp();
    const response = await get(app, '/api/v1/admin/reports/subscriptions?market=US');
    expect(response.status).toBe(403);
    expect(response.body.details).toEqual({ code: 'market_forbidden' });
    expect(repository.subscriptionPeriod).not.toHaveBeenCalled();
  });

  test('an admin without a market is asked for one', async () => {
    const { app } = reportsApp({ role: 'admin', markets: ['BR', 'US'] });
    const response = await get(app, '/api/v1/admin/reports/revenue');
    expect(response.status).toBe(400);
    expect(response.body.details).toEqual({ code: 'report_market_required' });
  });

  test('an invalid period is rejected', async () => {
    const { app } = reportsApp();
    const response = await get(app, '/api/v1/admin/reports/revenue?from=2025-01-01&to=2026-10-28');
    expect(response.status).toBe(400);
    expect(response.body.details).toEqual({ code: 'report_period_invalid' });
  });

  test('the summary of an operator BR has only the Brazil block', async () => {
    const { app } = reportsApp();
    const response = await get(app, '/api/v1/admin/reports/summary');
    expect(response.status).toBe(200);
    expect(response.body.markets.map((block) => block.market)).toEqual(['BR']);
  });

  test('an admin summary has both markets', async () => {
    const { app } = reportsApp({ role: 'admin', markets: ['BR', 'US'] });
    const response = await get(app, '/api/v1/admin/reports/summary');
    expect(response.body.markets.map((block) => [block.market, block.currency])).toEqual([['BR', 'BRL'], ['US', 'USD']]);
  });

  test('a database timeout answers 503 report_timeout', async () => {
    const repository = emptyRepository();
    repository.invoiceTotals.mockRejectedValue(new HttpError(503, 'The report took too long.', { code: 'report_timeout' }));
    const { app } = reportsApp({ repository });
    const response = await get(app, '/api/v1/admin/reports/revenue');
    expect(response.status).toBe(503);
    expect(response.body.details).toEqual({ code: 'report_timeout' });
  });

  test('the operator export downloads a CSV for Excel with the report file name', async () => {
    const { app } = reportsApp();
    const response = await get(app, '/api/v1/admin/reports/export.csv?report=revenue');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toBe('attachment; filename="eden-revenue-BR-2026-09-28-2026-10-27.csv"');
    expect(response.text.startsWith('﻿')).toBe(true);
  });

  test('an unknown export report is report_unknown', async () => {
    const { app } = reportsApp();
    const response = await get(app, '/api/v1/admin/reports/export.csv?report=customers');
    expect(response.status).toBe(400);
    expect(response.body.details).toEqual({ code: 'report_unknown' });
  });

  test('report routes do not accept writes', async () => {
    const { app } = reportsApp();
    const response = await request(app).post('/api/v1/admin/reports/revenue').set('Authorization', `Bearer ${token()}`).send({});
    expect(response.status).toBe(404);
  });
});
