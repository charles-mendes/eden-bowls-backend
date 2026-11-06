const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { ROLE_PERMISSIONS } = require('../src/core/admin-roles');
const { HttpError } = require('../src/core/http-error');

const jwt = { secret: 'test-secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };
const token = () => issueJwtToken({ data: { user: { id: 7 } } }, { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) });
const auth = (req) => req.set('Authorization', `Bearer ${token()}`);
const admin = { roles: ['admin'], permissions: ROLE_PERMISSIONS.admin };

function appWith(createForSubscription) {
  const upsShipmentService = { createForSubscription };
  const app = createApp({
    corsOrigins: ['http://localhost:5174'],
    jwt,
    adminIdentityService: { requireOperational: jest.fn().mockResolvedValue({ userId: '7', email: 'ops@edenbowls.com', ...admin }) },
    upsShipmentService
  });
  return app;
}

describe('POST /api/v1/admin/billing/subscriptions/:id/shipments', () => {
  test('passes confirm_not_ready only when it is true', async () => {
    const createForSubscription = jest.fn().mockResolvedValue({ success: true, data: { reused: false } });
    const app = appWith(createForSubscription);

    await auth(request(app).post('/api/v1/admin/billing/subscriptions/1/shipments')).send({ invoice_id: 'in_1', confirm_not_ready: true });
    await auth(request(app).post('/api/v1/admin/billing/subscriptions/1/shipments')).send({ invoice_id: 'in_1', confirm_not_ready: 'yes' });

    expect(createForSubscription.mock.calls[0][0]).toMatchObject({ subscriptionId: '1', invoiceId: 'in_1', confirmNotReady: true });
    expect(createForSubscription.mock.calls[1][0]).toMatchObject({ confirmNotReady: false });
  });

  test('answers the 409 with the reasons', async () => {
    const reasons = [{ code: 'production_not_ready', production_status: 'in_production' }];
    const app = appWith(jest.fn().mockRejectedValue(new HttpError(409, 'Not ready.', { code: 'ups_label_needs_confirmation', reasons })));

    const response = await auth(request(app).post('/api/v1/admin/billing/subscriptions/1/shipments')).send({ invoice_id: 'in_1' });

    expect(response.status).toBe(409);
    expect(response.body.details).toMatchObject({ code: 'ups_label_needs_confirmation', reasons });
  });
});
