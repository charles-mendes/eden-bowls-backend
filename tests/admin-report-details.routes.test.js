const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { ROLE_PERMISSIONS } = require('../src/core/admin-roles');
const { marketPermissions } = require('../src/core/admin-market-scope');
const { AdminReportsService } = require('../src/services/admin-reports.service');
const { AdminReportDetailsService } = require('../src/services/admin-report-details.service');

const jwt = { secret: 'test-secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };

function token() {
  return issueJwtToken({ data: { user: { id: 7 } } }, { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) });
}

function repository(overrides = {}) {
  return {
    invoiceTotals: jest.fn().mockResolvedValue({ revenue: 30000, invoices: 2, firstPurchaseRevenue: 0, firstPurchaseInvoices: 0, excludedInvoices: 0 }),
    invoiceSeries: jest.fn().mockResolvedValue([]),
    recurringPrices: jest.fn().mockResolvedValue([]),
    detailRecords: jest.fn().mockResolvedValue([
      { id: '1', invoiceNumber: 'EB-2026-000001', date: '2026-10-05T15:00:00Z', groupKey: 'subscription_cycle', currency: 'brl', userId: '7', subscriptionId: '42', contribution: '30000' }
    ]),
    detailTotals: jest.fn().mockResolvedValue({ totals: { count: 1, contribution: 30000 }, groups: [] }),
    customerNames: jest.fn().mockResolvedValue({ 7: 'Ana' }),
    ...overrides
  };
}

function detailsApp({ role = 'operator', markets = ['BR'], repo = repository() } = {}) {
  const now = () => new Date('2026-10-28T18:00:00Z');
  const adminReportsService = new AdminReportsService({ repository: repo, now });
  const adminReportDetailsService = new AdminReportDetailsService({ reportsService: adminReportsService, repository: repo, logger: { error: jest.fn() } });
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
    adminReportsService,
    adminReportDetailsService
  });
  return { app, repo };
}

const get = (app, path) => request(app).get(path).set('Authorization', `Bearer ${token()}`);

describe('admin report details routes', () => {
  test('readonly opens the details of gross revenue', async () => {
    const { app } = detailsApp({ role: 'readonly' });
    const response = await get(app, '/api/v1/admin/reports/details?report=revenue&indicator=grossRevenue&market=BR');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      label: 'Faturamento bruto',
      value: 30000,
      reconciliation: { matches: true },
      records: { page: 1, perPage: 50, total: 1 }
    });
    expect(response.body.records.items[0]).toMatchObject({ reference: 'EB-2026-000001', customer: { name: 'Ana', link: '/users/7' } });
  });

  test('paging caps at 200 per page', async () => {
    const { app, repo } = detailsApp();
    await get(app, '/api/v1/admin/reports/details?report=revenue&indicator=grossRevenue&page=3&perPage=500');
    expect(repo.detailRecords.mock.calls[0][3]).toEqual({ limit: 200, offset: 400 });
  });

  test('an operator of Brazil cannot open United States details', async () => {
    const { app, repo } = detailsApp();
    const response = await get(app, '/api/v1/admin/reports/details?report=revenue&indicator=grossRevenue&market=US');
    expect(response.status).toBe(403);
    expect(response.body.details).toMatchObject({ code: 'market_forbidden' });
    expect(repo.detailRecords).not.toHaveBeenCalled();
  });

  test('a veterinarian is forbidden', async () => {
    const { app } = detailsApp({ role: 'veterinarian' });
    expect((await get(app, '/api/v1/admin/reports/details?report=revenue&indicator=grossRevenue')).status).toBe(403);
  });

  test('an unknown indicator is report_indicator_unknown', async () => {
    const { app } = detailsApp();
    const response = await get(app, '/api/v1/admin/reports/details?report=revenue&indicator=customers');
    expect(response.status).toBe(400);
    expect(response.body.details).toMatchObject({ code: 'report_indicator_unknown' });
  });

  test('the details route does not take writes', async () => {
    const { app } = detailsApp();
    expect((await request(app).post('/api/v1/admin/reports/details').set('Authorization', `Bearer ${token()}`)).status).toBe(404);
  });

  test('the operator downloads the details CSV named after the figure', async () => {
    const { app } = detailsApp();
    const response = await get(app, '/api/v1/admin/reports/details/export.csv?report=revenue&indicator=grossRevenue&market=BR');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toBe('attachment; filename="eden-revenue-grossRevenue-BR-2026-09-28-2026-10-27.csv"');
    expect(response.text.startsWith('﻿')).toBe(true);
    expect(response.text).toContain('"Total";"";"";"";"1 registro(s)";"";"300,00"');
  });

  test('readonly cannot export the details', async () => {
    const { app } = detailsApp({ role: 'readonly' });
    expect((await get(app, '/api/v1/admin/reports/details/export.csv?report=revenue&indicator=grossRevenue')).status).toBe(403);
  });

  test('a CSV above the cap is 413 report_detail_too_large', async () => {
    const { app } = detailsApp({ repo: repository({ detailTotals: jest.fn().mockResolvedValue({ totals: { count: 60000, contribution: 0 }, groups: [] }) }) });
    const response = await get(app, '/api/v1/admin/reports/details/export.csv?report=revenue&indicator=grossRevenue');
    expect(response.status).toBe(413);
    expect(response.body.details).toMatchObject({ code: 'report_detail_too_large', total: 60000 });
  });
});
