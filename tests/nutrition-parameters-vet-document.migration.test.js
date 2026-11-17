const { NutritionParametersVetDocument1700000000077 } = require('../src/infrastructure/migrations/1700000000077-nutrition-parameters-vet-document');
const { COMBINATION_FACTORS, DEFAULT_NUTRITION_PARAMETERS, GIANT_COMBINATION_FACTORS } = require('../src/core/nutrition-recommendation');

const legacy = () => ({
  combination: { ...COMBINATION_FACTORS, 'SIM-BAIXO-ACIMA': 70 },
  state: { ...DEFAULT_NUTRITION_PARAMETERS.state },
  base: { dog: 95, cat: 242, cat_overweight: 134, dogue: 200 },
  nem: { dog: 3600, cat: 3800 },
  breed_groups: { dogue: ['great dane'], slow_metabolism: [], terranova: [] }
});

function queryRunner({ published = [], drafts = [], events = [] } = {}) {
  return {
    hasTable: jest.fn().mockResolvedValue(true),
    query: jest.fn(async (sql) => {
      if (sql.includes("status = 'published'") && sql.startsWith('SELECT')) return published;
      if (sql.includes("status = 'draft'") && sql.startsWith('SELECT')) return drafts;
      if (sql.includes('admin_audit_events') && sql.trim().startsWith('SELECT')) return events;
      if (sql.startsWith('INSERT INTO `nutrition_parameter_sets`')) return { insertId: 9 };
      return undefined;
    })
  };
}

const calls = (runner, prefix) => runner.query.mock.calls.filter(([sql]) => sql.trim().startsWith(prefix));

describe('NutritionParametersVetDocument1700000000077', () => {
  test('publishes the old set with the giant matrix and the cat factors, keeping the edited values, and audits it', async () => {
    const runner = queryRunner({ published: [{ id: 4, parameters: JSON.stringify(legacy()) }] });

    await new NutritionParametersVetDocument1700000000077().up(runner);

    expect(calls(runner, 'UPDATE')[0]).toEqual(["UPDATE `nutrition_parameter_sets` SET status = 'retired' WHERE id = ?", [4]]);
    const [insertSet, insertAudit] = calls(runner, 'INSERT');
    const published = JSON.parse(insertSet[1][0]);
    expect(published.combination['SIM-BAIXO-ACIMA']).toBe(70);
    expect(published.combination_giant).toEqual(GIANT_COMBINATION_FACTORS);
    expect(published.base).toEqual({ cat: 60, cat_active: 100 });
    expect(published.breed_groups.dogue).toEqual(['great dane']);
    expect(insertAudit[0]).toContain("'nutrition.parameters.publish'");
    expect(JSON.parse(insertAudit[1][0])).toEqual({ from_set_id: 4, to_set_id: 9, reason: 'requerimento_energetico' });
  });

  test('upgrades a draft in place and leaves a current published set alone', async () => {
    const runner = queryRunner({
      published: [{ id: 5, parameters: DEFAULT_NUTRITION_PARAMETERS }],
      drafts: [{ id: 6, parameters: JSON.stringify(legacy()) }]
    });

    await new NutritionParametersVetDocument1700000000077().up(runner);

    expect(calls(runner, 'INSERT')).toHaveLength(0);
    const [update] = calls(runner, 'UPDATE');
    expect(update[0]).toBe('UPDATE `nutrition_parameter_sets` SET parameters = ? WHERE id = ?');
    expect(JSON.parse(update[1][0]).base).toEqual({ cat: 60, cat_active: 100 });
    expect(update[1][1]).toBe(6);
  });

  test('down publishes again the set it retired', async () => {
    const runner = queryRunner({ events: [{ metadata: JSON.stringify({ from_set_id: 4, to_set_id: 9, reason: 'requerimento_energetico' }) }] });

    await new NutritionParametersVetDocument1700000000077().down(runner);

    const updates = calls(runner, 'UPDATE');
    expect(updates[0][1]).toEqual([9]);
    expect(updates[1][0]).toContain("status = 'published'");
    expect(updates[1][1]).toEqual([4]);
  });
});
