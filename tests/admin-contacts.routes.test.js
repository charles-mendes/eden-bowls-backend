const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { ROLE_PERMISSIONS } = require('../src/core/admin-roles');
const { HttpError } = require('../src/core/http-error');
const { CustomerContactsService } = require('../src/services/customer-contacts.service');

const jwt = { secret: 'test-secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };
const token = () => issueJwtToken({ data: { user: { id: 7 } } }, { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) });
const auth = (req) => req.set('Authorization', `Bearer ${token()}`);
const brOperator = { roles: ['operator'], markets: ['BR'], permissions: ROLE_PERMISSIONS.operator };
const usOperator = { roles: ['operator'], markets: ['US'], permissions: ROLE_PERMISSIONS.operator };
const readonly = { roles: ['readonly'], markets: ['BR'], permissions: ROLE_PERMISSIONS.readonly };
const NOW = new Date('2026-11-05T14:05:00Z');

function appFor(identity) {
  const rows = [];
  const repository = {
    insert: jest.fn(async (payload) => {
      const row = { id: rows.length + 1, subscription_id: payload.subscriptionId, user_id: payload.userId, stripe_account: payload.stripeAccount, reason: payload.reason, outcome: payload.outcome, note: payload.note, actor_id: payload.actorId, actor_email: payload.actorEmail, created_at: payload.createdAt };
      rows.push(row);
      return row;
    }),
    listBySubscription: jest.fn(async () => [...rows].sort((a, b) => b.created_at - a.created_at))
  };
  const adminBillingService = {
    getSubscription: jest.fn(async (_id, actor) => {
      if (actor.markets && !actor.markets.includes('BR')) throw new HttpError(404, 'Not found.');
      return { id: '42', stripeAccount: 'br', status: 'past_due', user: { id: '9', email: 'ana@example.com' } };
    })
  };
  const auditService = { record: jest.fn() };
  const customerContactsService = new CustomerContactsService({ repository, adminBillingService, auditService, now: () => NOW });
  const app = createApp({
    corsOrigins: ['http://localhost:5174'],
    jwt,
    adminIdentityService: { requireOperational: jest.fn().mockResolvedValue({ userId: '7', email: 'ops@edenbowls.com', ...identity }) },
    customerContactsService
  });
  return { app, repository, rows, auditService };
}

const post = (app, body) => auth(request(app).post('/api/v1/admin/billing/subscriptions/42/contacts')).send(body);

describe('customer contact routes', () => {
  test('an operator records a refused payment with no answer', async () => {
    const { app, rows, auditService } = appFor(brOperator);
    const response = await post(app, { reason: 'payment_failed', outcome: 'no_answer', note: '  Mandei mensagem  ' });
    expect(response.status).toBe(200);
    expect(response.body.data.contact).toMatchObject({ channel: 'whatsapp', reason: 'payment_failed', outcome: 'no_answer', note: 'Mandei mensagem', actor_email: 'ops@edenbowls.com', created_at: NOW.toISOString() });
    expect(rows[0]).toMatchObject({ subscription_id: '42', user_id: '9', stripe_account: 'br', actor_id: '7' });
    expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'customers.contact.create', targetUserId: '9' }));
    expect(auditService.record.mock.calls[0][0].metadata).not.toHaveProperty('note');
  });

  test.each([
    [{ reason: 'payment_failed', outcome: 'angry' }, 'outcome'],
    [{ reason: 'gossip', outcome: 'resolved' }, 'reason'],
    [{ reason: 'late', outcome: 'resolved', note: 'a'.repeat(501) }, 'note']
  ])('an invalid field answers 422 and stores nothing (%#)', async (body, field) => {
    const { app, repository } = appFor(brOperator);
    const response = await post(app, body);
    expect(response.status).toBe(422);
    expect(response.body.details).toMatchObject({ code: 'invalid_contact', field });
    expect(repository.insert).not.toHaveBeenCalled();
  });

  test('readonly reads but cannot record', async () => {
    const { app } = appFor(readonly);
    expect((await post(app, { reason: 'late', outcome: 'resolved' })).status).toBe(403);
    expect((await auth(request(app).get('/api/v1/admin/billing/subscriptions/42/contacts'))).status).toBe(200);
  });

  test('lists the newest first', async () => {
    const { app, rows } = appFor(brOperator);
    rows.push(
      { id: 1, subscription_id: '42', reason: 'late', outcome: 'no_answer', created_at: new Date('2026-11-04T10:00:00Z') },
      { id: 2, subscription_id: '42', reason: 'late', outcome: 'resolved', created_at: new Date('2026-11-05T10:00:00Z') }
    );
    const response = await auth(request(app).get('/api/v1/admin/billing/subscriptions/42/contacts'));
    expect(response.body.data.items.map((item) => item.id)).toEqual([2, 1]);
  });

  test('another market answers 404', async () => {
    const { app, repository } = appFor(usOperator);
    expect((await post(app, { reason: 'late', outcome: 'resolved' })).status).toBe(404);
    expect(repository.insert).not.toHaveBeenCalled();
  });
});
