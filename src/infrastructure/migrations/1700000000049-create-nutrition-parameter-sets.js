const { Table } = require('typeorm');
const { DEFAULT_NUTRITION_PARAMETERS } = require('../../core/nutrition-recommendation');

const TABLE = 'nutrition_parameter_sets';

// Versioned numbers and breed energy groups of the nutrition calculation (nutrition-parameters). Seeds one
// published set with the values the code used before the table, so every recommendation is unchanged; a
// published set already present is kept.
class CreateNutritionParameterSets1700000000049 {
  name = 'CreateNutritionParameterSets1700000000049';

  async up(queryRunner) {
    if (!(await queryRunner.hasTable(TABLE))) {
      await queryRunner.createTable(new Table({
        name: TABLE,
        columns: [
          { name: 'id', type: 'bigint', unsigned: true, isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
          { name: 'status', type: 'varchar', length: '10', isNullable: false },
          { name: 'parameters', type: 'json', isNullable: false },
          { name: 'created_by', type: 'bigint', unsigned: true, isNullable: true },
          { name: 'published_by', type: 'bigint', unsigned: true, isNullable: true },
          { name: 'published_at', type: 'datetime', isNullable: true },
          { name: 'created_at', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP' },
          { name: 'updated_at', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' }
        ],
        indices: [{ name: 'IDX_nutrition_parameter_sets_status', columnNames: ['status'] }]
      }), true);
    }
    const published = await queryRunner.query(`SELECT id FROM \`${TABLE}\` WHERE status = 'published' LIMIT 1`);
    if (!Array.isArray(published) || published.length === 0) {
      await queryRunner.query(
        `INSERT INTO \`${TABLE}\` (status, parameters, published_at) VALUES ('published', ?, CURRENT_TIMESTAMP)`,
        [JSON.stringify(DEFAULT_NUTRITION_PARAMETERS)]
      );
    }
  }

  async down(queryRunner) {
    if (await queryRunner.hasTable(TABLE)) {
      await queryRunner.dropTable(TABLE);
    }
  }
}

module.exports = {
  CreateNutritionParameterSets1700000000049
};
