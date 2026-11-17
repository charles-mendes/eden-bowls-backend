const { NutritionDefaultFoodEnergy1700000000078 } = require('../src/infrastructure/migrations/1700000000078-nutrition-default-food-energy');
const { DEFAULT_NUTRITION_PARAMETERS } = require('../src/core/nutrition-recommendation');

const withNem = (nem) => ({ ...JSON.parse(JSON.stringify(DEFAULT_NUTRITION_PARAMETERS)), nem });

function queryRunner({ published = [], drafts = [], events = [] } = {}) {
  return {
    hasTable: jest.fn().mockResolvedValue(true),
    query: jest.fn(async (sql) => {
      if (sql.includes("status = 'published'") && sql.startsWith('SELECT')) return published;
      if (sql.includes("status = 'draft'") && sql.startsWith('SELECT')) return drafts;
      if (sql.includes('admin_audit_events') && sql.trim().startsWith('SELECT')) return events;
      if (sql.startsWith('INSERT INTO `nutrition_parameter_sets`')) return { insertId: 11 };
      return undefined;
    })
  };
}

const calls = (runner, prefix) => runner.query.mock.calls.filter(([sql]) => sql.trim().startsWith(prefix));

describe('NutritionDefaultFoodEnergy1700000000078', () => {
  test('swaps the dry-kibble defaults 3600/3800 for 1200 and audits the change', async () => {
    const runner = queryRunner({ published: [{ id: 9, parameters: JSON.stringify(withNem({ dog: 3600, cat: 3800 })) }] });

    await new NutritionDefaultFoodEnergy1700000000078().up(runner);

    const [insertSet, insertAudit] = calls(runner, 'INSERT');
    expect(JSON.parse(insertSet[1][0]).nem).toEqual({ dog: 1200, cat: 1200 });
    expect(JSON.parse(insertAudit[1][0])).toEqual({
      from_set_id: 9,
      to_set_id: 11,
      reason: 'em_alimento_fresco',
      changes: [{ field: 'nem.dog', from: 3600, to: 1200 }, { field: 'nem.cat', from: 3800, to: 1200 }]
    });
  });

  test('keeps an EM someone edited', async () => {
    const runner = queryRunner({ published: [{ id: 9, parameters: withNem({ dog: 1150, cat: 3800 }) }] });

    await new NutritionDefaultFoodEnergy1700000000078().up(runner);

    expect(JSON.parse(calls(runner, 'INSERT')[0][1][0]).nem).toEqual({ dog: 1150, cat: 1200 });
  });

  test('changes nothing when no default is left, and updates a draft in place', async () => {
    const runner = queryRunner({
      published: [{ id: 9, parameters: withNem({ dog: 1200, cat: 1200 }) }],
      drafts: [{ id: 10, parameters: withNem({ dog: 3600, cat: 1000 }) }]
    });

    await new NutritionDefaultFoodEnergy1700000000078().up(runner);

    expect(calls(runner, 'INSERT')).toHaveLength(0);
    const [update] = calls(runner, 'UPDATE');
    expect(JSON.parse(update[1][0]).nem).toEqual({ dog: 1200, cat: 1000 });
    expect(update[1][1]).toBe(10);
  });

  test('down publishes again the set it retired', async () => {
    const runner = queryRunner({ events: [{ metadata: JSON.stringify({ from_set_id: 9, to_set_id: 11, reason: 'em_alimento_fresco' }) }] });

    await new NutritionDefaultFoodEnergy1700000000078().down(runner);

    const updates = calls(runner, 'UPDATE');
    expect(updates[0][1]).toEqual([11]);
    expect(updates[1][1]).toEqual([9]);
  });
});
