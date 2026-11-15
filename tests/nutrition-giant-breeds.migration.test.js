const { NutritionGiantBreeds1700000000079, withGiantBreeds } = require('../src/infrastructure/migrations/1700000000079-nutrition-giant-breeds');
const { DEFAULT_NUTRITION_PARAMETERS } = require('../src/core/nutrition-recommendation');
const { GIANT_BREED_GROUPS } = require('../src/core/giant-breeds');
const { parseNutritionParameters } = require('../src/core/nutrition-parameters');

// The lists published before this migration.
const FIRST_LISTS = {
  dogue: ['dogue alemao', 'great dane', 'irish wolfhound', 'scottish deerhound', 'borzoi', 'greyhound', 'anatolian', 'anatolian shepherd', 'leonberger'],
  slow_metabolism: ['sao bernardo', 'sao bernard', 'saint bernard'],
  terranova: ['terra nova', 'terranova', 'newfoundland']
};
const withGroups = (breed_groups) => ({ ...JSON.parse(JSON.stringify(DEFAULT_NUTRITION_PARAMETERS)), breed_groups });

function queryRunner({ published = [], drafts = [], events = [] } = {}) {
  return {
    hasTable: jest.fn().mockResolvedValue(true),
    query: jest.fn(async (sql) => {
      if (sql.includes("status = 'published'") && sql.startsWith('SELECT')) return published;
      if (sql.includes("status = 'draft'") && sql.startsWith('SELECT')) return drafts;
      if (sql.includes('admin_audit_events') && sql.trim().startsWith('SELECT')) return events;
      if (sql.startsWith('INSERT INTO `nutrition_parameter_sets`')) return { insertId: 12 };
      return undefined;
    })
  };
}

const calls = (runner, prefix) => runner.query.mock.calls.filter(([sql]) => sql.trim().startsWith(prefix));

describe('NutritionGiantBreeds1700000000079', () => {
  test('publishes the giant breeds over 40 kg, drops Greyhound and Borzoi, and audits it', async () => {
    const runner = queryRunner({ published: [{ id: 11, parameters: JSON.stringify(withGroups(FIRST_LISTS)) }] });

    await new NutritionGiantBreeds1700000000079().up(runner);

    const [insertSet, insertAudit] = calls(runner, 'INSERT');
    const groups = JSON.parse(insertSet[1][0]).breed_groups;
    expect(groups.dogue).toEqual(expect.arrayContaining(['rottweiler', 'mastim tibetano', 'tibetan mastiff', 'fila brasileiro', 'cane corso', 'boiadeiro de berna']));
    expect(groups.dogue).not.toEqual(expect.arrayContaining(['greyhound']));
    expect(groups.dogue).not.toContain('borzoi');
    expect(groups.terranova).toEqual(['terra nova', 'terranova', 'newfoundland', 'landseer']);
    expect(groups.slow_metabolism).toEqual(FIRST_LISTS.slow_metabolism);
    // The published set passes the same validation as a draft saved in the admin.
    expect(() => parseNutritionParameters(JSON.parse(insertSet[1][0]))).not.toThrow();
    const audit = JSON.parse(insertAudit[1][0]);
    expect(audit).toMatchObject({ from_set_id: 11, to_set_id: 12, reason: 'racas_gigantes' });
    expect(audit.changes.map((change) => change.field)).toEqual(['breed_groups.dogue', 'breed_groups.terranova']);
  });

  test('keeps a breed someone added, in its own list', () => {
    const upgraded = withGiantBreeds(withGroups({ ...FIRST_LISTS, slow_metabolism: [...FIRST_LISTS.slow_metabolism, 'rottweiler', 'mastim pirineus'] }));

    expect(upgraded.parameters.breed_groups.slow_metabolism).toEqual(['sao bernardo', 'sao bernard', 'saint bernard', 'rottweiler', 'mastim pirineus']);
    expect(upgraded.parameters.breed_groups.dogue).not.toContain('rottweiler');
  });

  test('changes nothing on the current lists, and updates a draft in place', async () => {
    const runner = queryRunner({
      published: [{ id: 11, parameters: withGroups(GIANT_BREED_GROUPS) }],
      drafts: [{ id: 13, parameters: withGroups(FIRST_LISTS) }]
    });

    await new NutritionGiantBreeds1700000000079().up(runner);

    expect(calls(runner, 'INSERT')).toHaveLength(0);
    const [update] = calls(runner, 'UPDATE');
    expect(JSON.parse(update[1][0]).breed_groups.dogue).toContain('rottweiler');
    expect(update[1][1]).toBe(13);
  });

  test('down publishes again the set it retired', async () => {
    const runner = queryRunner({ events: [{ metadata: JSON.stringify({ from_set_id: 11, to_set_id: 12, reason: 'racas_gigantes' }) }] });

    await new NutritionGiantBreeds1700000000079().down(runner);

    const updates = calls(runner, 'UPDATE');
    expect(updates[0][1]).toEqual([12]);
    expect(updates[1][1]).toEqual([11]);
  });
});
