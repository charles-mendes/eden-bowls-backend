const fs = require('fs');
const path = require('path');
const { AddRecipePresentation1700000000045 } = require('../src/infrastructure/migrations/1700000000045-add-recipe-presentation');
const { RECIPE_TEXTS, seedRecipePresentation } = require('../src/infrastructure/migrations/helpers/seed-recipe-presentations');

// Copy of the store's eden-bowls/src/content/__snapshots__/lifeStageRecipesContent.test.ts.snap (pt-BR files of
// the puppy and senior lines). The snapshot body is an object literal.
function storeSnapshot() {
  const raw = fs.readFileSync(path.join(__dirname, 'fixtures/store-life-stage-recipes.snap.txt'), 'utf8');
  const body = raw.match(/= `\n([\s\S]*?)\n`;/)[1];
  return new Function(`return (${body});`)();
}

function queryRunner({ rows = [], hasColumn = false, tables = ['recipe_contents'] } = {}) {
  return {
    hasTable: jest.fn(async (name) => tables.includes(name)),
    hasColumn: jest.fn().mockResolvedValue(hasColumn),
    addColumn: jest.fn().mockResolvedValue(undefined),
    dropColumn: jest.fn().mockResolvedValue(undefined),
    query: jest.fn(async (sql) => (sql.startsWith('SELECT') ? rows : undefined))
  };
}

describe('seedRecipePresentation', () => {
  test('has the eight store recipes in both markets', () => {
    const keys = ['beef', 'turkey', 'fish', 'pork', 'puppy-beef-chicken', 'puppy-chicken-pork', 'senior-beef', 'senior-chicken'];
    expect(Object.keys(RECIPE_TEXTS.BR).sort()).toEqual([...keys].sort());
    expect(Object.keys(RECIPE_TEXTS.US).sort()).toEqual([...keys].sort());
  });

  test('matches the store files of the puppy and senior lines in pt-BR', () => {
    for (const [key, content] of Object.entries(storeSnapshot())) {
      const seed = seedRecipePresentation('BR', key);
      expect(seed).toMatchObject({ title: content.title, tagline: content.tagline, resume: content.resume, highlights: content.highlights });
      expect(seed.colors.color).toBe(content.color);
    }
  });

  test('uses the market language and the store colors', () => {
    expect(seedRecipePresentation('US', 'turkey')).toEqual({
      title: 'Chicken Recipe',
      tagline: 'Light & Lean',
      resume: 'A lean and flavorful option, packed with natural goodness your dog will love.',
      highlights: ['Cassava', 'Chicken', 'Kabocha Squash', 'Green Beans', 'Broccoli'],
      colors: { color: '#B08F66', accentColor: '#D0A860', pillBg: '#E4D0A8', pillText: '#3C2800', pillBorder: '#B09060' }
    });
    expect(seedRecipePresentation('BR', 'turkey').title).toBe('Receita de Frango');
  });

  test('has no presentation for an unknown key or market', () => {
    expect(seedRecipePresentation('BR', 'bovino-e-frango')).toBeNull();
    expect(seedRecipePresentation('MX', 'beef')).toBeNull();
  });
});

describe('AddRecipePresentation1700000000045', () => {
  test('Seed after deploy: adds the columns and fills every store recipe without a presentation', async () => {
    const runner = queryRunner({
      rows: [
        { id: 1, market: 'BR', recipeKey: 'beef' },
        { id: 2, market: 'us', recipeKey: 'senior-chicken' },
        { id: 3, market: 'BR', recipeKey: 'bovino-e-frango' }
      ]
    });

    await new AddRecipePresentation1700000000045().up(runner);

    expect(runner.addColumn.mock.calls.map(([table, column]) => [table, column.name, column.type, column.isNullable])).toEqual([
      ['recipe_contents', 'presentation', 'json', true],
      ['recipe_contents', 'presentation_updated_at', 'datetime', true]
    ]);
    expect(runner.query.mock.calls[0][0]).toContain('WHERE presentation IS NULL');
    const updates = runner.query.mock.calls.filter(([sql]) => sql.startsWith('UPDATE'));
    expect(updates.map(([sql, params]) => [sql.includes('AND presentation IS NULL'), JSON.parse(params[0]), params[1]])).toEqual([
      [true, seedRecipePresentation('BR', 'beef'), 1],
      [true, seedRecipePresentation('US', 'senior-chicken'), 2]
    ]);
  });

  test('Saved presentation survives a rerun: only rows without a presentation are read and written', async () => {
    const runner = queryRunner({ hasColumn: true, rows: [] });

    await new AddRecipePresentation1700000000045().up(runner);

    expect(runner.addColumn).not.toHaveBeenCalled();
    expect(runner.query.mock.calls).toHaveLength(1);
    expect(runner.query.mock.calls[0][0]).toContain('WHERE presentation IS NULL');
  });

  test('down drops both columns', async () => {
    const runner = queryRunner({ hasColumn: true });
    await new AddRecipePresentation1700000000045().down(runner);
    expect(runner.dropColumn.mock.calls.map(([, name]) => name)).toEqual(['presentation_updated_at', 'presentation']);
  });

  test('does nothing without the table', async () => {
    const runner = queryRunner({ tables: [] });
    await new AddRecipePresentation1700000000045().up(runner);
    expect(runner.addColumn).not.toHaveBeenCalled();
    expect(runner.query).not.toHaveBeenCalled();
  });
});
