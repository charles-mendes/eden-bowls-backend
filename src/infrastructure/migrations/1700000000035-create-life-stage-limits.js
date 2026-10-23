const { Table, TableIndex } = require('typeorm');
const { buildBreedSeedRows, buildSizeClassSeedRows } = require('../../core/life-stage-seed');

const SIZE_CLASSES_TABLE = 'life_stage_size_classes';
const BREEDS_TABLE = 'life_stage_breeds';

const idColumn = {
  name: 'id',
  type: 'int',
  unsigned: true,
  isPrimary: true,
  isGenerated: true,
  generationStrategy: 'increment'
};

const auditColumns = [
  { name: 'updated_by', type: 'bigint', unsigned: true, isNullable: true },
  { name: 'created_at', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP' },
  { name: 'updated_at', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' }
];

// Stage limits live in rows per market so a future admin screen can change them without a deploy.
class CreateLifeStageLimits1700000000035 {
  name = 'CreateLifeStageLimits1700000000035';

  async up(queryRunner) {
    if (!(await queryRunner.hasTable(SIZE_CLASSES_TABLE))) {
      await queryRunner.createTable(new Table({
        name: SIZE_CLASSES_TABLE,
        columns: [
          idColumn,
          { name: 'market', type: 'varchar', length: '8', isNullable: false },
          { name: 'size_class', type: 'varchar', length: '16', isNullable: false },
          { name: 'adult_from_months', type: 'int', unsigned: true, isNullable: false },
          { name: 'senior_from_months', type: 'int', unsigned: true, isNullable: false },
          ...auditColumns
        ]
      }), true);
      await queryRunner.createIndex(SIZE_CLASSES_TABLE, new TableIndex({
        name: 'uniq_life_stage_size_classes_market_class',
        columnNames: ['market', 'size_class'],
        isUnique: true
      }));
    }

    if (!(await queryRunner.hasTable(BREEDS_TABLE))) {
      await queryRunner.createTable(new Table({
        name: BREEDS_TABLE,
        columns: [
          idColumn,
          { name: 'market', type: 'varchar', length: '8', isNullable: false },
          { name: 'name_pt', type: 'varchar', length: '191', isNullable: false },
          { name: 'name_en', type: 'varchar', length: '191', isNullable: false },
          { name: 'name_pt_normalized', type: 'varchar', length: '191', isNullable: false },
          { name: 'name_en_normalized', type: 'varchar', length: '191', isNullable: false },
          { name: 'size_class', type: 'varchar', length: '16', isNullable: false },
          { name: 'active', type: 'boolean', isNullable: false, default: true },
          ...auditColumns
        ]
      }), true);
      // A breed may have two Portuguese spellings for one English name, so the pair is the key.
      await queryRunner.createIndex(BREEDS_TABLE, new TableIndex({
        name: 'uniq_life_stage_breeds_market_names',
        columnNames: ['market', 'name_pt_normalized', 'name_en_normalized'],
        isUnique: true
      }));
      await queryRunner.createIndex(BREEDS_TABLE, new TableIndex({
        name: 'idx_life_stage_breeds_market_pt',
        columnNames: ['market', 'name_pt_normalized']
      }));
      await queryRunner.createIndex(BREEDS_TABLE, new TableIndex({
        name: 'idx_life_stage_breeds_market_en',
        columnNames: ['market', 'name_en_normalized']
      }));
    }

    for (const row of buildSizeClassSeedRows()) {
      await queryRunner.query(
        `INSERT IGNORE INTO ${SIZE_CLASSES_TABLE} (market, size_class, adult_from_months, senior_from_months)
         VALUES (?, ?, ?, ?)`,
        [row.market, row.sizeClass, row.adultFromMonths, row.seniorFromMonths]
      );
    }
    for (const row of buildBreedSeedRows()) {
      await queryRunner.query(
        `INSERT IGNORE INTO ${BREEDS_TABLE}
          (market, name_pt, name_en, name_pt_normalized, name_en_normalized, size_class, active)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
        [row.market, row.namePt, row.nameEn, row.namePtNormalized, row.nameEnNormalized, row.sizeClass]
      );
    }
  }

  async down(queryRunner) {
    if (await queryRunner.hasTable(BREEDS_TABLE)) {
      await queryRunner.dropTable(BREEDS_TABLE);
    }
    if (await queryRunner.hasTable(SIZE_CLASSES_TABLE)) {
      await queryRunner.dropTable(SIZE_CLASSES_TABLE);
    }
  }
}

module.exports = {
  CreateLifeStageLimits1700000000035
};
