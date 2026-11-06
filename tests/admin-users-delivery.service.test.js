const { AdminUsersService } = require('../src/services/admin-users.service');

const user = { id: '8', email: 'ana@example.com', profileMarket: 'BR', storedRoles: [], roles: [] };

function build() {
  const profileService = { updateDelivery: jest.fn(async ({ payload }) => ({ ...payload })) };
  const auditService = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new AdminUsersService({ usersRepository: {}, profileService, auditService, adminEmails: [] });
  service.requireExistingUser = jest.fn().mockResolvedValue(user);
  service.assertCustomerInScope = jest.fn();
  return { service, profileService, auditService };
}

const address = { zipcode: '01001000', street: 'Rua A', number: '1', city: 'São Paulo', state: 'SP' };

describe('AdminUsersService.updateDelivery audit', () => {
  test('saves the address without the reason and audits the reason and the field names', async () => {
    const { service, profileService, auditService } = build();
    await service.updateDelivery('8', { ...address, reason: '  Cliente pediu por telefone ' }, { id: 1 });

    expect(profileService.updateDelivery).toHaveBeenCalledWith({ userId: '8', payload: address, skipAccountCheck: true });
    const event = auditService.record.mock.calls[0][0];
    expect(event).toMatchObject({ action: 'users.delivery.update', actor: { id: 1 }, target: user });
    expect(event.metadata).toEqual({ fields: ['city', 'number', 'state', 'street', 'zipcode'], reason: 'Cliente pediu por telefone' });
    expect(JSON.stringify(event.metadata)).not.toContain('Rua A');
  });

  test('without a reason the correction is still audited', async () => {
    const { service, auditService } = build();
    await service.updateDelivery('8', address, { id: 1 });
    expect(auditService.record.mock.calls[0][0].metadata).toEqual({ fields: ['city', 'number', 'state', 'street', 'zipcode'] });
  });

  test.each(['x', 'a'.repeat(256)])('refuses reason %#.length before saving', async (reason) => {
    const { service, profileService, auditService } = build();
    await expect(service.updateDelivery('8', { ...address, reason }, { id: 1 }))
      .rejects.toMatchObject({ statusCode: 422, details: { code: 'invalid_reason' } });
    expect(profileService.updateDelivery).not.toHaveBeenCalled();
    expect(auditService.record).not.toHaveBeenCalled();
  });
});
