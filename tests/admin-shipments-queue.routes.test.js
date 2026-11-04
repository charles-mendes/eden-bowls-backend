const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { ROLE_PERMISSIONS } = require('../src/core/admin-roles');
const { UpsShipmentService } = require('../src/services/ups-shipment.service');

const jwt = { secret: 'test-secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };
const token = () => issueJwtToken({ data: { user: { id: 7 } } }, { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) });
const address = { name: 'Ana Costa', line1: '1 Main St', city: 'Miami', state: 'FL', postal_code: '33101', country: 'US' };
const cycle = (id, invoice, extra = {}) => ({
  id, stripeSubscriptionId: `sub_${id}`, paidInvoiceId: invoice, productionStatus: 'ready', status: 'active', deliveryDate: '2026-11-05', address, ...extra
});

function appFor(identity, { cycles = [], shipments = [] } = {}) {
  const listPaidLabelCycles = jest.fn().mockResolvedValue(cycles);
  const upsShipmentService = new UpsShipmentService({
    repository: { listActiveByInvoiceIds: jest.fn().mockResolvedValue(shipments) },
    ledgerRepository: { listPaidLabelCycles },
    upsClient: { isConfigured: () => true },
    shippingService: { settings: { us: { ship_from: { zipcode: '33101' } } } }
  });
  const app = createApp({
    corsOrigins: ['http://localhost:5174'],
    jwt,
    adminIdentityService: { requireOperational: jest.fn().mockResolvedValue({ userId: '7', email: 'ops@edenbowls.com', ...identity }) },
    upsShipmentService
  });
  return { app, listPaidLabelCycles };
}

const get = (app) => request(app).get('/api/v1/admin/shipments/queue').set('Authorization', `Bearer ${token()}`);
const admin = { roles: ['admin'], permissions: ROLE_PERMISSIONS.admin };

describe('GET /api/v1/admin/shipments/queue', () => {
  test('lists a ready order, a P.O. Box order with its reason, and an unknown row', async () => {
    const { app } = appFor(admin, {
      cycles: [cycle(1, 'in_ready'), cycle(2, 'in_pobox', { address: { ...address, line1: 'PO Box 9' } }), cycle(3, 'in_unknown')],
      shipments: [{ id: 30, stripe_invoice_id: 'in_unknown', status: 'unknown' }]
    });

    const response = await get(app);

    expect(response.status).toBe(200);
    expect(response.body.data.ready.map((item) => [item.invoice_id, item.issues])).toEqual([
      ['in_ready', []],
      ['in_pobox', [{ code: 'po_box_not_allowed' }]]
    ]);
    expect(response.body.data.unresolved[0]).toMatchObject({ invoice_id: 'in_unknown', shipment: { id: 30, status: 'unknown' } });
  });

  test('Staff limited to Brazil: lists nothing and reads no cycle', async () => {
    const { app, listPaidLabelCycles } = appFor({ roles: ['operator'], markets: ['BR'], permissions: ROLE_PERMISSIONS.operator }, { cycles: [cycle(1, 'in_ready')] });

    const response = await get(app);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ ready: [], unresolved: [], created: [], truncated: false });
    expect(listPaidLabelCycles).not.toHaveBeenCalled();
  });

  test('a US operator sees the queue', async () => {
    const { app } = appFor({ roles: ['operator'], markets: ['US'], permissions: ROLE_PERMISSIONS.operator }, { cycles: [cycle(1, 'in_ready')] });

    expect((await get(app)).body.data.ready).toHaveLength(1);
  });

  test('refuses a role without shipping.read', async () => {
    const { app } = appFor({ roles: ['veterinarian'], permissions: ROLE_PERMISSIONS.veterinarian });

    expect((await get(app)).status).toBe(403);
  });
});
