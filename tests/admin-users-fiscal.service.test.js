const { AdminUsersService } = require('../src/services/admin-users.service');

const user = { id: '8', email: 'ana@example.com', profileMarket: 'BR', storedRoles: [], roles: [] };

function build() {
  const usersRepository = {
    findUserById: jest.fn().mockResolvedValue(user),
    findFiscalData: jest.fn().mockResolvedValue({ fullName: 'Ana Maria Souza', cpf: '52998224725' }),
    saveFiscalData: jest.fn().mockResolvedValue(undefined)
  };
  const auditService = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new AdminUsersService({ usersRepository, auditService, adminEmails: [] });
  service.requireExistingUser = jest.fn().mockResolvedValue(user);
  service.assertCustomerInScope = jest.fn();
  service.scopedSubscriptions = jest.fn().mockResolvedValue([]);
  return { service, usersRepository, auditService };
}

describe('AdminUsersService fiscal data', () => {
  test('saves the name and the CPF digits and keeps them out of the audit', async () => {
    const { service, usersRepository, auditService } = build();
    const result = await service.updateFiscal('8', { fullName: ' Ana  Souza ', cpf: '529.982.247-25' }, { id: 1 });

    expect(usersRepository.saveFiscalData).toHaveBeenCalledWith('8', { fullName: 'Ana Souza', cpf: '52998224725' });
    expect(result.data).toEqual({ fullName: 'Ana Souza', cpf: '52998224725' });
    expect(JSON.stringify(auditService.record.mock.calls[0][0].metadata)).not.toContain('52998224725');
  });

  test.each([
    [{ fullName: 'Ana', cpf: '52998224725' }, 'invalid_fiscal_name'],
    [{ fullName: 'Ana Souza', cpf: '11222333000181' }, 'invalid_tax_document']
  ])('refuses %j', async (payload, code) => {
    const { service, usersRepository } = build();
    await expect(service.updateFiscal('8', payload, { id: 1 })).rejects.toMatchObject({ statusCode: 422, details: { code } });
    expect(usersRepository.saveFiscalData).not.toHaveBeenCalled();
  });

  test('the customer detail shows the CPF only to who can edit it', async () => {
    const { service, usersRepository } = build();
    const editor = await service.getById('8', { permissions: ['users.delivery.write'] });
    expect(editor.fiscal).toEqual({ fullName: 'Ana Maria Souza', cpf: '52998224725' });

    usersRepository.findFiscalData.mockClear();
    const reader = await service.getById('8', { permissions: ['users.read'] });
    expect(reader).not.toHaveProperty('fiscal');
    expect(usersRepository.findFiscalData).not.toHaveBeenCalled();
  });

  test('the list shows the address country and falls back to the market', () => {
    const { service } = build();
    expect(service.presentListItem({ id: '1', storedRoles: '', addressCountry: 'US', profileMarket: 'BR' }).country).toBe('US');
    expect(service.presentListItem({ id: '1', storedRoles: '', addressCountry: '', profileMarket: 'BR' }).country).toBe('BR');
    expect(service.presentListItem({ id: '1', storedRoles: '', addressCountry: '', profileMarket: '' }).country).toBeNull();
  });
});
