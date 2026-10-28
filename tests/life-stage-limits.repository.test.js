const { LifeStageLimitsRepository } = require('../src/infrastructure/repositories/life-stage-limits.repository');

function dataSource(limitRows, breedRows) {
  return {
    query: jest.fn(async (sql) => (sql.includes('life_stage_size_classes') ? limitRows : breedRows))
  };
}

describe('LifeStageLimitsRepository', () => {
  test('reads limits and both breed names of a market, and caches them', async () => {
    const source = dataSource(
      [{ size_class: 'medium', adult_from_months: 12, senior_from_months: 96 }],
      [{ name_pt_normalized: 'dogue alemao', name_en_normalized: 'great dane', size_class: 'giant' }]
    );
    const repository = new LifeStageLimitsRepository(source);

    const first = await repository.forMarket('br');
    await repository.forMarket('BR');

    expect(first.limits).toEqual({ medium: { adultFromMonths: 12, seniorFromMonths: 96 } });
    expect([...first.breedClasses.entries()]).toEqual([['dogue alemao', 'giant'], ['great dane', 'giant']]);
    expect(source.query).toHaveBeenCalledTimes(2);
    expect(source.query.mock.calls.map(([, params]) => params)).toEqual([['BR'], ['BR']]);
  });

  test('a database without the tables yields no limits instead of failing', async () => {
    const repository = new LifeStageLimitsRepository({
      query: jest.fn().mockRejectedValue(new Error("ER_NO_SUCH_TABLE: Table 'x.life_stage_size_classes' doesn't exist"))
    });
    const result = await repository.forMarket('US');
    expect(result.limits).toEqual({});
    expect(result.breedClasses.size).toBe(0);
  });

  test('saving limits writes each size class of the market and clears the cache', async () => {
    const source = dataSource([{ size_class: 'medium', adult_from_months: 12, senior_from_months: 96 }], []);
    const repository = new LifeStageLimitsRepository(source);
    await repository.forMarket('BR');
    const manager = { query: jest.fn().mockResolvedValue({}) };

    await repository.saveLimits('br', { medium: { adultFromMonths: 12, seniorFromMonths: 84 } }, 5, manager);
    await repository.forMarket('BR');

    expect(manager.query).toHaveBeenCalledTimes(1);
    expect(manager.query.mock.calls[0][0]).toContain('ON DUPLICATE KEY UPDATE');
    expect(manager.query.mock.calls[0][1]).toEqual(['BR', 'medium', 12, 84, 5]);
    expect(source.query).toHaveBeenCalledTimes(4);
  });

  test('adding a breed listed twice answers 409 life_stage_breed_exists', async () => {
    const repository = new LifeStageLimitsRepository({ isInitialized: true, query: jest.fn() });
    const duplicate = Object.assign(new Error('ER_DUP_ENTRY: Duplicate entry'), { code: 'ER_DUP_ENTRY' });
    const manager = { query: jest.fn().mockRejectedValue(duplicate) };
    const breed = { namePt: 'Dogue Alemão', nameEn: 'Great Dane', namePtNormalized: 'dogue alemao', nameEnNormalized: 'great dane', sizeClass: 'giant', active: true };

    await expect(repository.createBreed('BR', breed, 5, manager)).rejects.toMatchObject({
      statusCode: 409,
      details: { code: 'life_stage_breed_exists' }
    });
  });

  test('lists the pets of customers with a delivering plan on the account', async () => {
    const query = jest.fn().mockResolvedValue([{ id: 3, breed: 'SRD', size: 'medium', age_years: 7, age_months: 2, age_recorded_at: null, birth_date: null }]);
    const repository = new LifeStageLimitsRepository({ isInitialized: true, query });

    const pets = await repository.listSubscribedPets('BR');

    expect(pets).toEqual([{ id: '3', breed: 'SRD', size: 'medium', age_years: 7, age_months: 2, age_recorded_at: null, birth_date: null }]);
    expect(query.mock.calls[0][1]).toEqual(['br', 'active', 'trialing', 'past_due']);
    expect(query.mock.calls[0][0]).not.toMatch(/UPDATE|INSERT|DELETE/);
  });
});
