const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { ROLE_PERMISSIONS } = require('../src/core/admin-roles');
const { HttpError } = require('../src/core/http-error');
const { SubscriptionPaidCyclesService } = require('../src/services/subscription-paid-cycles.service');

const jwt = { secret: 'test-secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };
const token = () => issueJwtToken({ data: { user: { id: 7 } } }, { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) });
const auth = (req) => req.set('Authorization', `Bearer ${token()}`);
const usOperator = { roles: ['operator'], markets: ['US'], permissions: ROLE_PERMISSIONS.operator };
const brOperator = { roles: ['operator'], markets: ['BR'], permissions: ROLE_PERMISSIONS.operator };
const readonly = { roles: ['readonly'], markets: ['US'], permissions: ROLE_PERMISSIONS.readonly };

const cycle = (paidInvoiceId, extra = {}) => ({ id: 5, paidInvoiceId, productionStatus: 'ready', preparationDay: '2026-11-02', deliveryDate: '2026-11-05', paidAt: '2026-11-01 12:00:00', ...extra });

function appFor(identity, { cycles = [cycle('in_1')], shipments = [], courier = [] } = {}) {
  const adminBillingService = {
    getSubscription: jest.fn(async (_id, actor) => {
      if (actor.markets && !actor.markets.includes('US')) throw new HttpError(404, 'Not found.');
      return { id: '5', stripeAccount: 'us' };
    })
  };
  const ledgerRepository = { listPaidCyclesBySubscription: jest.fn(async () => cycles) };
  const upsShipmentRepository = { listActiveByInvoiceIds: jest.fn(async () => shipments) };
  const courierDeliveryRepository = { listByInvoiceIds: jest.fn(async () => courier) };
  const subscriptionPaidCyclesService = new SubscriptionPaidCyclesService({ adminBillingService, ledgerRepository, upsShipmentRepository, courierDeliveryRepository });
  const app = createApp({
    corsOrigins: ['http://localhost:5174'],
    jwt,
    adminIdentityService: { requireOperational: jest.fn().mockResolvedValue({ userId: '7', email: 'ops@edenbowls.com', ...identity }) },
    subscriptionPaidCyclesService
  });
  return { app, ledgerRepository };
}

const get = (app) => auth(request(app).get('/api/v1/admin/billing/subscriptions/5/paid-cycles'));

describe('GET /api/v1/admin/billing/subscriptions/:id/paid-cycles', () => {
  test('a ready cycle with no label and no courier delivery', async () => {
    const { app, ledgerRepository } = appFor(usOperator);
    const response = await get(app);
    expect(response.status).toBe(200);
    expect(ledgerRepository.listPaidCyclesBySubscription).toHaveBeenCalledWith('5', 24);
    expect(response.body.data.items).toEqual([{
      invoice_id: 'in_1', preparation_day: '2026-11-02', production_status: 'ready', delivery_date: '2026-11-05',
      paid_at: '2026-11-01T12:00:00.000Z', ups_shipment: null, courier_delivery: null
    }]);
  });

  test('a cycle with a label and one with a courier delivery, a canceled attempt counting as none', async () => {
    const { app } = appFor(usOperator, {
      cycles: [cycle('in_1'), cycle('in_2'), cycle('in_3')],
      shipments: [{ id: 9, stripe_invoice_id: 'in_1', status: 'created', tracking_number: '1Z1' }],
      courier: [
        { id: 1, stripe_invoice_id: 'in_2', status: 'failed', failed_at: '2026-11-03 10:00:00' },
        { id: 2, stripe_invoice_id: 'in_2', status: 'out_for_delivery', out_for_delivery_at: '2026-11-04 10:00:00' },
        { id: 3, stripe_invoice_id: 'in_3', status: 'canceled' }
      ]
    });
    const [first, second, third] = (await get(app)).body.data.items;
    expect(first.ups_shipment).toEqual({ id: 9, status: 'created', tracking_number: '1Z1' });
    expect(second.courier_delivery).toMatchObject({ id: 2, status: 'out_for_delivery', out_for_delivery_at: '2026-11-04T10:00:00.000Z' });
    expect(third.courier_delivery).toBeNull();
  });

  test('readonly reads it; another market answers 404', async () => {
    expect((await get(appFor(readonly).app)).status).toBe(200);
    expect((await get(appFor(brOperator).app)).status).toBe(404);
  });
});
