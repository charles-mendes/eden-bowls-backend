const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { ROLE_PERMISSIONS } = require('../src/core/admin-roles');

const jwt = { secret: 'test-secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };

function token() {
  return issueJwtToken({ data: { user: { id: 7 } } }, { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) });
}

function adminApp(customerInvoicesService, permissions = ROLE_PERMISSIONS.admin) {
  return createApp({
    corsOrigins: ['http://localhost:5174'],
    jwt,
    adminIdentityService: {
      requireOperational: jest.fn().mockResolvedValue({
        userId: '7',
        email: 'admin@edenbowls.com',
        roles: ['admin'],
        permissions
      })
    },
    customerInvoicesService
  });
}

describe('admin customer invoice routes', () => {
  test('lists the invoices of a subscription', async () => {
    const service = { listForSubscription: jest.fn().mockResolvedValue({ success: true, data: { items: [{ invoice_number: 'EB-2026-000418' }] } }) };

    const response = await request(adminApp(service))
      .get('/api/v1/admin/billing/subscriptions/9/customer-invoices')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(response.body.data.items[0].invoice_number).toBe('EB-2026-000418');
    expect(service.listForSubscription).toHaveBeenCalledWith('9', expect.objectContaining({ userId: '7' }));
  });

  test('downloads the PDF as an attachment', async () => {
    const service = {
      downloadPdf: jest.fn().mockResolvedValue({
        binary: true,
        buffer: Buffer.from('%PDF-1.3'),
        contentType: 'application/pdf',
        filename: 'EB-2026-000418.pdf'
      })
    };

    const response = await request(adminApp(service))
      .get('/api/v1/admin/billing/customer-invoices/12/pdf')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.headers['content-disposition']).toBe('attachment; filename="EB-2026-000418.pdf"');
  });

  test('issues an older Stripe invoice and resends one by email', async () => {
    const service = {
      issueFromAdmin: jest.fn().mockResolvedValue({ success: true, data: { id: 12 } }),
      resendEmail: jest.fn().mockResolvedValue({ success: true, data: { email_status: 'sent' } })
    };
    const app = adminApp(service);

    const issued = await request(app)
      .post('/api/v1/admin/billing/subscriptions/9/customer-invoices')
      .send({ stripe_invoice_id: 'in_1' })
      .set('Authorization', `Bearer ${token()}`);
    const sent = await request(app)
      .post('/api/v1/admin/billing/customer-invoices/12/send')
      .set('Authorization', `Bearer ${token()}`);

    expect(issued.status).toBe(200);
    expect(service.issueFromAdmin).toHaveBeenCalledWith('9', 'in_1', expect.any(Object));
    expect(sent.body.data.email_status).toBe('sent');
  });

  test('a reader without the sync permission cannot resend', async () => {
    const service = { resendEmail: jest.fn() };
    const permissions = ROLE_PERMISSIONS.admin.filter((permission) => permission !== 'billing.subscribers.sync');

    const response = await request(adminApp(service, permissions))
      .post('/api/v1/admin/billing/customer-invoices/12/send')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(403);
    expect(service.resendEmail).not.toHaveBeenCalled();
  });
});
