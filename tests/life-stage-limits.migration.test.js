const fs = require('fs');
const path = require('path');
const { CreateLifeStageLimits1700000000035 } = require('../src/infrastructure/migrations/1700000000035-create-life-stage-limits');
const { GIANT_BREEDS, buildBreedSeedRows, buildSizeClassSeedRows, normalizeBreedName } = require('../src/core/life-stage-seed');

function queryRunner({ hasTable = false } = {}) {
  return {
    hasTable: jest.fn().mockResolvedValue(hasTable),
    createTable: jest.fn().mockResolvedValue(undefined),
    createIndex: jest.fn().mockResolvedValue(undefined),
    dropTable: jest.fn().mockResolvedValue(undefined),
    query: jest.fn().mockResolvedValue(undefined)
  };
}

function giantPairsFromCsv() {
  const csv = fs.readFileSync(path.join(__dirname, '../docs/life-stage/breeds-life-stage.csv'), 'utf8').trim().split('\n');
  const header = csv[0].split(',');
  const pairs = new Set();
  for (const line of csv.slice(1)) {
    const row = Object.fromEntries(line.split(',').map((value, index) => [header[index], value]));
    if (row.life_stage_class === 'giant') {
      pairs.add(`${normalizeBreedName(row.name_pt)}|${normalizeBreedName(row.name_en)}`);
    }
  }
  return pairs;
}

describe('life stage seed', () => {
  test('holds the approved limits for BR and US', () => {
    expect(buildSizeClassSeedRows()).toEqual(['BR', 'US'].flatMap((market) => [
      { market, sizeClass: 'small', adultFromMonths: 10, seniorFromMonths: 120 },
      { market, sizeClass: 'medium', adultFromMonths: 12, seniorFromMonths: 96 },
      { market, sizeClass: 'large', adultFromMonths: 15, seniorFromMonths: 84 },
      { market, sizeClass: 'giant', adultFromMonths: 18, seniorFromMonths: 72 }
    ]));
  });

  test('holds every distinct giant name pair of the CSV, once', () => {
    const seeded = new Set(GIANT_BREEDS.map(([pt, en]) => `${normalizeBreedName(pt)}|${normalizeBreedName(en)}`));
    expect(seeded.size).toBe(GIANT_BREEDS.length);
    expect(seeded).toEqual(giantPairsFromCsv());
    expect(GIANT_BREEDS).toHaveLength(47);
  });

  test('normalizes case, accents and surrounding spaces', () => {
    expect(normalizeBreedName('  Dogue Alemão ')).toBe('dogue alemao');
  });
});

describe('CreateLifeStageLimits1700000000035', () => {
  test('creates both tables with their unique keys and seeds limits and breeds', async () => {
    const runner = queryRunner();
    await new CreateLifeStageLimits1700000000035().up(runner);

    const tables = runner.createTable.mock.calls.map(([table]) => table.name);
    expect(tables).toEqual(['life_stage_size_classes', 'life_stage_breeds']);
    const unique = runner.createIndex.mock.calls.filter(([, index]) => index.isUnique).map(([table, index]) => [table, index.columnNames]);
    expect(unique).toEqual([
      ['life_stage_size_classes', ['market', 'size_class']],
      ['life_stage_breeds', ['market', 'name_pt_normalized', 'name_en_normalized']]
    ]);
    expect(runner.query).toHaveBeenCalledTimes(buildSizeClassSeedRows().length + buildBreedSeedRows().length);
    for (const [sql] of runner.query.mock.calls) {
      expect(sql).toMatch(/^INSERT IGNORE INTO life_stage_(size_classes|breeds)/);
    }
  });

  test('a second run only re-seeds, without creating tables', async () => {
    const runner = queryRunner({ hasTable: true });
    await new CreateLifeStageLimits1700000000035().up(runner);
    expect(runner.createTable).not.toHaveBeenCalled();
    expect(runner.createIndex).not.toHaveBeenCalled();
  });

  test('down drops both tables', async () => {
    const runner = queryRunner({ hasTable: true });
    await new CreateLifeStageLimits1700000000035().down(runner);
    expect(runner.dropTable.mock.calls.map(([name]) => name)).toEqual(['life_stage_breeds', 'life_stage_size_classes']);
  });
});
