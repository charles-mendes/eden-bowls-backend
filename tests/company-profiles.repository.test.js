const { CompanyProfilesRepository } = require('../src/infrastructure/repositories/company-profiles.repository');
const { COMPANY_PROFILE_SEED } = require('../src/core/company-profile');

describe('CompanyProfilesRepository', () => {
  test('reads a market once per cache window and clears it on save', async () => {
    const query = jest.fn(async (sql) => (sql.startsWith('SELECT') ? [{ legal_name: 'X', city: 'São Paulo', state: 'SP', support_email: 'a@b.co' }] : {}));
    const repository = new CompanyProfilesRepository({ isInitialized: true, query });

    expect((await repository.forMarket('br')).city).toBe('São Paulo');
    await repository.forMarket('BR');
    expect(query).toHaveBeenCalledTimes(1);

    await repository.save('BR', { ...COMPANY_PROFILE_SEED.BR }, 1);
    await repository.forMarket('BR');
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[1][0]).toContain('ON DUPLICATE KEY UPDATE');
  });

  test('without the table the printed data applies, and a market without profile reads as US', async () => {
    const repository = new CompanyProfilesRepository({
      isInitialized: true,
      query: jest.fn().mockRejectedValue(new Error("ER_NO_SUCH_TABLE: Table 'x.company_profiles' doesn't exist"))
    });
    expect(await repository.forMarket('BR')).toMatchObject({ taxId: '65.291.985/0001-05', city: 'Curitiba' });
    expect(await repository.forMarket('')).toMatchObject({ city: 'Boca Raton' });
  });
});
