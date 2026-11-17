const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { ROLE_PERMISSIONS } = require('../src/core/admin-roles');
const { AdminBillingService } = require('../src/services/admin-billing.service');

// delivery-instructions: an operator sets or clears the instructions of one subscription.
const brOperator = { userId: 5, email: 'op@edenbowls.com', roles: ['operator'], markets: ['BR'] };
const usOperator = { userId: 6, email: 'us@edenbowls.com', roles: ['operator'], markets: ['US'] };
const address = { country: 'BR', street: 'Rua A', number: '10', neighborhood: 'Centro', city: 'Curitiba', state: 'PR', zipcode: '80000-000', recipient_name: 'Ana Costa' };

function build({ row = {}, updated = true } = {}) {
  const item = { id: 200, userId: 9, customerEmail: 'ana@example.com', stripeSubscriptionId: 'sub_1', status: 'active', stripeAccount: 'br', profileMarket: 'BR', address, ...row };
  const ledgerRepository = {
    findById: jest.fn(async () => item),
    setAddressDeliveryInstructions: jest.fn(async () => updated)
  };
  const auditService = { record: jest.fn(async () => undefined) };
  const service = new AdminBillingService({
    ledgerRepository,
    auditService,
    stripeAccounts: { us: { secretKey: 'sk_test_us' }, br: { secretKey: 'sk_test_br' } }
  });
  return { service, ledgerRepository, auditService };
}

const status = (promise) => promise.then(() => null, (error) => ({ status: error.statusCode, field: error.details && error.details.field }));

describe('updateDeliveryInstructions', () => {
  test('operator fixes the gate: only that key changes and the audit has no text', async () => {
    const { service, ledgerRepository, auditService } = build();
    const result = await service.updateDeliveryInstructions('200', { delivery_instructions: '  Portão\n lateral ' }, brOperator);

    expect(result).toEqual({ success: true, data: { subscription_id: '200', delivery_instructions: 'Portão lateral' } });
    expect(ledgerRepository.setAddressDeliveryInstructions).toHaveBeenCalledWith(200, 'Portão lateral');
    expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'billing.subscriptions.delivery_instructions.update',
      targetUserId: 9,
      metadata: { subscriptionId: '200', fields: ['delivery_instructions'], cleared: false }
    }));
    expect(JSON.stringify(auditService.record.mock.calls[0][0])).not.toContain('lateral');
  });

  test('an empty string clears and answers null', async () => {
    const { service, ledgerRepository } = build();
    const result = await service.updateDeliveryInstructions('200', { delivery_instructions: '' }, brOperator);
    expect(result.data.delivery_instructions).toBeNull();
    expect(ledgerRepository.setAddressDeliveryInstructions).toHaveBeenCalledWith(200, '');
  });

  test('other market answers 404 and nothing is saved', async () => {
    const { service, ledgerRepository, auditService } = build();
    expect(await status(service.updateDeliveryInstructions('200', { delivery_instructions: 'Portão' }, usOperator))).toMatchObject({ status: 404 });
    expect(ledgerRepository.setAddressDeliveryInstructions).not.toHaveBeenCalled();
    expect(auditService.record).not.toHaveBeenCalled();
  });

  test('an unknown subscription answers 404', async () => {
    const { service, ledgerRepository } = build();
    ledgerRepository.findById.mockResolvedValueOnce(null);
    expect(await status(service.updateDeliveryInstructions('999', { delivery_instructions: 'Portão' }, brOperator))).toMatchObject({ status: 404 });
  });

  test('too long answers 422 with the field and nothing is saved', async () => {
    const { service, ledgerRepository } = build();
    expect(await status(service.updateDeliveryInstructions('200', { delivery_instructions: 'a'.repeat(201) }, brOperator)))
      .toMatchObject({ status: 422, field: 'delivery_instructions' });
    expect(ledgerRepository.setAddressDeliveryInstructions).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/v1/admin/billing/subscriptions/:id/delivery-instructions', () => {
  const jwt = { secret: 'test-secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };
  const token = () => issueJwtToken({ data: { user: { id: 7 } } }, { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) });

  function appFor(identity) {
    const adminBillingService = { updateDeliveryInstructions: jest.fn(async () => ({ success: true, data: { subscription_id: '200', delivery_instructions: 'Portão' } })) };
    const app = createApp({
      corsOrigins: ['http://localhost:5174'],
      jwt,
      adminIdentityService: { requireOperational: jest.fn().mockResolvedValue({ userId: '7', email: 'ops@edenbowls.com', ...identity }) },
      adminBillingService
    });
    return { app, adminBillingService };
  }

  test('missing permission answers 403 and nothing is saved', async () => {
    const { app, adminBillingService } = appFor({ roles: ['readonly'], markets: ['BR'], permissions: ROLE_PERMISSIONS.readonly });
    const response = await request(app)
      .patch('/api/v1/admin/billing/subscriptions/200/delivery-instructions')
      .set('Authorization', `Bearer ${token()}`)
      .send({ delivery_instructions: 'Portão' });
    expect(response.status).toBe(403);
    expect(adminBillingService.updateDeliveryInstructions).not.toHaveBeenCalled();
  });

  test('an operator reaches the service with the body', async () => {
    const { app, adminBillingService } = appFor({ roles: ['operator'], markets: ['BR'], permissions: ROLE_PERMISSIONS.operator });
    const response = await request(app)
      .patch('/api/v1/admin/billing/subscriptions/200/delivery-instructions')
      .set('Authorization', `Bearer ${token()}`)
      .send({ delivery_instructions: 'Portão' });
    expect(response.status).toBe(200);
    expect(adminBillingService.updateDeliveryInstructions).toHaveBeenCalledWith('200', { delivery_instructions: 'Portão' }, expect.objectContaining({ userId: '7' }));
  });
});
