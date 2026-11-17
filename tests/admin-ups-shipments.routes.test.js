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

describe('GET /api/v1/admin/shipments/:id/label', () => {
  const { UpsShipmentService } = require('../src/services/ups-shipment.service');

  function labelApp({ shipment, packages }) {
    const files = { 'label-1.gif': Buffer.from('BOX1'), 'label-2.gif': Buffer.from('BOX2'), 'label-old.gif': Buffer.from('OLD') };
    const upsShipmentService = new UpsShipmentService({
      repository: {
        findById: jest.fn().mockResolvedValue(shipment),
        listPackagesByShipmentIds: jest.fn().mockResolvedValue(packages)
      },
      labelStorage: { read: jest.fn(async (name) => files[name] || null) }
    });
    return createApp({
      corsOrigins: ['http://localhost:5174'],
      jwt,
      adminIdentityService: { requireOperational: jest.fn().mockResolvedValue({ userId: '7', email: 'ops@edenbowls.com', ...admin }) },
      upsShipmentService
    });
  }

  const twoBoxes = {
    shipment: { id: 9, subscription_id: '1', label_path: 'label-1.gif', label_format: 'GIF', status: 'created' },
    packages: [
      { shipment_id: 9, sequence: 1, box_key: 'monthly', pack_count: 30, weight_lb: 37.5, tracking_number: '1ZBOX1', label_path: 'label-1.gif' },
      { shipment_id: 9, sequence: 2, box_key: 'monthly', pack_count: 15, weight_lb: 21, tracking_number: '1ZBOX2', label_path: 'label-2.gif' }
    ]
  };

  test('Second box label: ?package=2 returns the second package label', async () => {
    const response = await auth(request(labelApp(twoBoxes)).get('/api/v1/admin/shipments/9/label?package=2')).buffer(true);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('image/gif');
    expect(Buffer.from(response.body).toString()).toBe('BOX2');
  });

  test('without ?package the first package label is returned', async () => {
    const response = await auth(request(labelApp(twoBoxes)).get('/api/v1/admin/shipments/9/label')).buffer(true);

    expect(Buffer.from(response.body).toString()).toBe('BOX1');
  });

  test('Package out of range: ?package=3 answers 404 label_not_found', async () => {
    const response = await auth(request(labelApp(twoBoxes)).get('/api/v1/admin/shipments/9/label?package=3'));

    expect(response.status).toBe(404);
    expect(response.body.details).toMatchObject({ code: 'label_not_found' });
  });

  test('a shipment bought before boxes still returns its label', async () => {
    const old = { shipment: { id: 5, subscription_id: '1', label_path: 'label-old.gif', label_format: 'GIF', status: 'created' }, packages: [] };

    const plain = await auth(request(labelApp(old)).get('/api/v1/admin/shipments/5/label')).buffer(true);
    const first = await auth(request(labelApp(old)).get('/api/v1/admin/shipments/5/label?package=1')).buffer(true);
    const second = await auth(request(labelApp(old)).get('/api/v1/admin/shipments/5/label?package=2'));

    expect(Buffer.from(plain.body).toString()).toBe('OLD');
    expect(Buffer.from(first.body).toString()).toBe('OLD');
    expect(second.status).toBe(404);
  });
});
