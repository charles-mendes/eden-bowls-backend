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
});
