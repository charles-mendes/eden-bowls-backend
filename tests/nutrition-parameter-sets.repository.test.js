const { NutritionParameterSetsRepository } = require('../src/infrastructure/repositories/nutrition-parameter-sets.repository');
const { DEFAULT_NUTRITION_PARAMETERS } = require('../src/core/nutrition-recommendation');

function row(overrides = {}) {
  return { id: 1, status: 'published', parameters: JSON.stringify({ base: { dog: 95 } }), created_by: null, published_by: 7, published_at: new Date('2026-10-27T10:00:00Z'), created_at: new Date('2026-10-27T10:00:00Z'), updated_at: new Date('2026-10-27T10:00:00Z'), ...overrides };
}

function dataSource(query) {
  return { isInitialized: true, query: jest.fn(query) };
}

describe('NutritionParameterSetsRepository', () => {
  test('reads the published set once per 60 s', async () => {
    const ds = dataSource(async () => [row()]);
    const repository = new NutritionParameterSetsRepository(ds);

    const first = await repository.published();
    const second = await repository.published();

    expect(first).toEqual({ id: 1, parameters: { base: { dog: 95 } }, publishedAt: '2026-10-27T10:00:00.000Z' });
    expect(second).toBe(first);
    expect(ds.query).toHaveBeenCalledTimes(1);
  });

  test('uses the values of the code, with no id, before the migration', async () => {
    const repository = new NutritionParameterSetsRepository(dataSource(async () => { throw new Error("ER_NO_SUCH_TABLE: Table 'nutrition_parameter_sets' doesn't exist"); }));

    expect(await repository.published()).toEqual({ id: null, parameters: DEFAULT_NUTRITION_PARAMETERS, publishedAt: null });
  });

  test('creates the draft once and then replaces its parameters', async () => {
    const drafts = [];
    const ds = dataSource(async (sql, params) => {
      if (sql.includes("status = 'draft'") && sql.startsWith('SELECT')) return drafts.slice(-1);
      if (sql.startsWith('INSERT')) { drafts.push(row({ id: 5, status: 'draft', parameters: params[0] })); return { insertId: 5 }; }
      if (sql.startsWith('UPDATE')) { drafts[0] = { ...drafts[0], parameters: params[0] }; return {}; }
      if (sql.includes('id = ?')) return drafts.filter((item) => item.id === params[0]);
      return [];
    });
    const repository = new NutritionParameterSetsRepository(ds);

    const created = await repository.saveDraft({ parameters: { base: { dog: 96 } }, actorId: 7 });
    const updated = await repository.saveDraft({ parameters: { base: { dog: 97 } }, actorId: 7 });

    expect(created).toMatchObject({ id: 5, status: 'draft', parameters: { base: { dog: 96 } } });
    expect(updated).toMatchObject({ id: 5, parameters: { base: { dog: 97 } } });
    expect(ds.query.mock.calls.filter(([sql]) => sql.startsWith('INSERT'))).toHaveLength(1);
  });

  test('publishing retires the previous set and clears the cache', async () => {
    const ds = dataSource(async () => [row()]);
    const repository = new NutritionParameterSetsRepository(ds);
    await repository.published();
    const manager = { query: jest.fn().mockResolvedValue({}) };

    await repository.publishDraft({ draftId: 5, actorId: 7 }, manager);

    expect(manager.query.mock.calls[0][0]).toContain("SET status = 'retired' WHERE status = 'published'");
    expect(manager.query.mock.calls[1][0]).toContain("SET status = 'published'");
    expect(manager.query.mock.calls[1][1]).toEqual([7, 5]);
    await repository.published();
    expect(ds.query).toHaveBeenCalledTimes(2);
  });
});
