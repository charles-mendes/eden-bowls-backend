const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { ROLE_PERMISSIONS } = require('../src/core/admin-roles');
const { HttpError } = require('../src/core/http-error');
const { CourierDeliveryService } = require('../src/services/courier-delivery.service');

const jwt = { secret: 'test-secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };
const token = () => issueJwtToken({ data: { user: { id: 7 } } }, { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) });
const brSubscription = { id: '42', stripeSubscriptionId: 'sub_br_1', stripeAccount: 'br', status: 'active', address: { country: 'BR', street: 'Rua A', number: '10', neighborhood: 'Centro', city: 'São Paulo', state: 'SP', zipcode: '01001000', recipient_name: 'João Lima' }, user: { id: '9', email: 'ana@example.com' } };
const paidInvoice = { id: 'in_1', status: 'paid', subscription: 'sub_br_1', billing_reason: 'subscription_cycle', subtotal: 25900 };

function appFor(identity, { productionStatus = 'ready', row = null, nfeRequired = false, notes = [] } = {}) {
  const repository = {
    insert: jest.fn(async (payload) => ({ inserted: true, row: { id: 1, subscription_id: payload.subscriptionId, stripe_invoice_id: payload.invoiceId, method: payload.method, status: 'out_for_delivery', out_for_delivery_at: new Date() } })),
    findById: jest.fn(async () => row),
    transition: jest.fn(async () => 1),
    listByStatus: jest.fn(async () => []),
    listDeliveredSince: jest.fn(async () => []),
    listByInvoiceIds: jest.fn(async () => []),
    listBySubscriptionId: jest.fn(async () => [])
  };
  // The billing service answers 404 for a record of another market, as the real one does.
  const adminBillingService = {
    getSubscription: jest.fn(async (_id, actor) => {
      if (actor.markets && !actor.markets.includes('BR')) throw new HttpError(404, 'Not found.');
      return brSubscription;
    }),
    getSubscriptionInvoice: jest.fn(async () => paidInvoice)
  };
  const ledgerRepository = {
    listPaidCourierCycles: jest.fn(async () => []),
    listPaidCyclesByInvoiceIds: jest.fn(async (ids) => ids.map((paidInvoiceId) => ({ id: 42, paidInvoiceId, productionStatus, status: 'active' })))
  };
  const nfeRepository = {
    findByStripeInvoice: jest.fn(async (account, invoiceId) => notes.find((note) => note.stripeAccount === account && note.stripeInvoiceId === invoiceId) || null),
    listByStripeInvoices: jest.fn(async () => notes)
  };
  const courierDeliveryService = new CourierDeliveryService({ repository, adminBillingService, ledgerRepository, nfeRepository, requireAuthorizedNfe: nfeRequired });
  const app = createApp({
    corsOrigins: ['http://localhost:5174'],
    jwt,
    adminIdentityService: { requireOperational: jest.fn().mockResolvedValue({ userId: '7', email: 'ops@edenbowls.com', ...identity }) },
    courierDeliveryService
  });
  return { app, repository, ledgerRepository };
}

const auth = (req) => req.set('Authorization', `Bearer ${token()}`);
const admin = { roles: ['admin'], permissions: ROLE_PERMISSIONS.admin };
const brOperator = { roles: ['operator'], markets: ['BR'], permissions: ROLE_PERMISSIONS.operator };
const usOperator = { roles: ['operator'], markets: ['US'], permissions: ROLE_PERMISSIONS.operator };
const readonly = { roles: ['readonly'], markets: ['BR'], permissions: ROLE_PERMISSIONS.readonly };
const onTheRoad = { id: 1, subscription_id: '42', stripe_invoice_id: 'in_1', status: 'out_for_delivery', out_for_delivery_at: new Date(Date.now() - 3600000) };

describe('admin courier delivery routes', () => {
  test('happy path: dispatch stores the delivery', async () => {
    const { app, repository } = appFor(brOperator);
    const response = await auth(request(app).post('/api/v1/admin/billing/subscriptions/42/courier-deliveries'))
      .send({ invoice_id: 'in_1', method: 'motoboy', cost: '12.00' });
    expect(response.status).toBe(200);
    expect(response.body.data.delivery).toMatchObject({ id: 1, status: 'out_for_delivery', method: 'motoboy' });
    expect(repository.insert.mock.calls[0][0]).toMatchObject({ costMinor: 1200, invoiceId: 'in_1' });
  });

  test('the 409 reasons payload reaches the response', async () => {
    const { app, repository } = appFor(admin, { productionStatus: 'in_production' });
    const response = await auth(request(app).post('/api/v1/admin/billing/subscriptions/42/courier-deliveries'))
      .send({ invoice_id: 'in_1', method: 'uber' });
    expect(response.status).toBe(409);
    expect(JSON.stringify(response.body)).toContain('courier_dispatch_needs_confirmation');
    expect(JSON.stringify(response.body)).toContain('production_not_ready');
    expect(repository.insert).not.toHaveBeenCalled();
  });

  // admin-flow-fixes-4 (PM-25): the fiscal lock's code and details reach the response.
  test('the fiscal lock answers 422 courier_nfe_not_authorized with the note', async () => {
    const { app, repository } = appFor(brOperator, { nfeRequired: true, notes: [{ id: 9, status: 'rejected', stripeAccount: 'br', stripeInvoiceId: 'in_1' }] });
    const response = await auth(request(app).post('/api/v1/admin/billing/subscriptions/42/courier-deliveries'))
      .send({ invoice_id: 'in_1', method: 'uber', confirm_not_ready: true });
    expect(response.status).toBe(422);
    expect(JSON.stringify(response.body)).toContain('courier_nfe_not_authorized');
    expect(JSON.stringify(response.body)).toContain('"nfe_status":"rejected"');
    expect(JSON.stringify(response.body)).toContain('"nfe_id":9');
    expect(repository.insert).not.toHaveBeenCalled();
  });

  test('Read-only staff gets 403 on a write and nothing changes', async () => {
    const { app, repository } = appFor(readonly, { row: onTheRoad });
    const response = await auth(request(app).post('/api/v1/admin/courier-deliveries/1/delivered')).send({});
    expect(response.status).toBe(403);
    expect(repository.transition).not.toHaveBeenCalled();
  });

  test('read-only staff can read the queue', async () => {
    const { app } = appFor(readonly);
    expect((await auth(request(app).get('/api/v1/admin/courier-deliveries/queue'))).status).toBe(200);
  });

  test('the queue reads the delivery range from the query', async () => {
    const { app, ledgerRepository } = appFor(brOperator);
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const response = await auth(request(app).get(`/api/v1/admin/courier-deliveries/queue?from=${today}&to=${today}`));
    expect(response.status).toBe(200);
    expect(response.body.data.range).toEqual({ from: today, to: today, default: false });
    expect(ledgerRepository.listPaidCourierCycles.mock.calls[0][0]).toMatchObject({ deliveryFloor: today, deliveryCeiling: today });
  });

  test('an invalid range answers 400 invalid_delivery_range', async () => {
    const { app } = appFor(brOperator);
    const response = await auth(request(app).get('/api/v1/admin/courier-deliveries/queue?from=2020-01-01'));
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain('invalid_delivery_range');
  });

  test('Staff limited to the US: the queue is empty', async () => {
    const { app, ledgerRepository } = appFor(usOperator);
    const response = await auth(request(app).get('/api/v1/admin/courier-deliveries/queue'));
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ to_dispatch: [], out_for_delivery: [], failed: [], delivered: [], truncated: false, later: 0, next_from: null });
    expect(ledgerRepository.listPaidCourierCycles).not.toHaveBeenCalled();
  });

  test('a record of another market answers 404', async () => {
    const { app, repository } = appFor(usOperator, { row: onTheRoad });
    const response = await auth(request(app).post('/api/v1/admin/courier-deliveries/1/failed')).send({ reason: 'x' });
    expect(response.status).toBe(404);
    expect(repository.transition).not.toHaveBeenCalled();
  });

  test('passes the failure kind through the route', async () => {
    const { app, repository } = appFor(brOperator, { row: onTheRoad });
    const response = await auth(request(app).post('/api/v1/admin/courier-deliveries/1/failed')).send({ reason: 'Portaria', failure_kind: 'address_unusable' });
    expect(response.status).toBe(200);
    expect(repository.transition.mock.calls[0][2]).toMatchObject({ reason: 'Portaria', kind: 'address_unusable' });
  });

  test('marks delivered, failed and cancels through the routes', async () => {
    const { app, repository } = appFor(brOperator, { row: onTheRoad });
    expect((await auth(request(app).post('/api/v1/admin/courier-deliveries/1/delivered')).send({})).status).toBe(200);
    expect((await auth(request(app).post('/api/v1/admin/courier-deliveries/1/failed')).send({ reason: 'Ninguém em casa' })).status).toBe(200);
    expect((await auth(request(app).post('/api/v1/admin/courier-deliveries/1/cancel'))).status).toBe(200);
    expect(repository.transition.mock.calls.map((call) => call[1])).toEqual(['delivered', 'failed', 'canceled']);
  });

  test('a non-numeric id is 404 and a non-text field is 422', async () => {
    const { app } = appFor(brOperator, { row: onTheRoad });
    expect((await auth(request(app).patch('/api/v1/admin/courier-deliveries/abc')).send({ note: 'x' })).status).toBe(404);
    expect((await auth(request(app).patch('/api/v1/admin/courier-deliveries/1')).send({ note: 5 })).status).toBe(422);
  });
});
