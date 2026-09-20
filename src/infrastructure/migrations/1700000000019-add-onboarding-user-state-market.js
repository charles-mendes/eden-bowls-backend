const { TableColumn, TableIndex } = require('typeorm');

const TABLE_NAME = 'onboarding_user_state';
const COLUMN_NAME = 'market';
const INDEX_NAME = 'idx_onboarding_user_state_market';

class AddOnboardingUserStateMarket1700000000019 {
  name = 'AddOnboardingUserStateMarket1700000000019';

  async up(queryRunner) {
    if (!(await queryRunner.hasTable(TABLE_NAME))) {
      return;
    }

    if (!(await queryRunner.hasColumn(TABLE_NAME, COLUMN_NAME))) {
      await queryRunner.addColumn(TABLE_NAME, new TableColumn({
        name: COLUMN_NAME,
        type: 'varchar',
        length: '2',
        isNullable: true
      }));
    }

    const table = await queryRunner.getTable(TABLE_NAME);
    const hasIndex = Boolean(table && (table.indices || []).some((index) => index.name === INDEX_NAME));
    if (!hasIndex) {
      await queryRunner.createIndex(TABLE_NAME, new TableIndex({
        name: INDEX_NAME,
        columnNames: [COLUMN_NAME]
      }));
    }
  }

  async down(queryRunner) {
    if (!(await queryRunner.hasTable(TABLE_NAME))) {
      return;
    }

    const table = await queryRunner.getTable(TABLE_NAME);
    const hasIndex = Boolean(table && (table.indices || []).some((index) => index.name === INDEX_NAME));
    if (hasIndex) {
      await queryRunner.dropIndex(TABLE_NAME, INDEX_NAME);
    }

    if (await queryRunner.hasColumn(TABLE_NAME, COLUMN_NAME)) {
      await queryRunner.dropColumn(TABLE_NAME, COLUMN_NAME);
    }
  }
}

module.exports = {
  AddOnboardingUserStateMarket1700000000019
};
