const TABLE = 'automated_email_settings';
const COLUMNS = {
  renewal_notice_enabled: 'TINYINT(1) NOT NULL DEFAULT 1',
  plan_ending_notice_enabled: 'TINYINT(1) NOT NULL DEFAULT 1',
  plan_notice_days: 'INT NOT NULL DEFAULT 7'
};

async function hasColumn(queryRunner, column) {
  const rows = await queryRunner.query(
    'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1',
    [TABLE, column]
  );
  return rows.length > 0;
}

// Plan notices per market (plan-notices): both on, with a 7-day window, until an operator changes them.
class AddPlanNoticeSettings1700000000060 {
  name = 'AddPlanNoticeSettings1700000000060';

  async up(queryRunner) {
    for (const [column, definition] of Object.entries(COLUMNS)) {
      if (!(await hasColumn(queryRunner, column))) {
        await queryRunner.query(`ALTER TABLE ${TABLE} ADD COLUMN ${column} ${definition}`);
      }
    }
  }

  async down(queryRunner) {
    for (const column of Object.keys(COLUMNS)) {
      if (await hasColumn(queryRunner, column)) {
        await queryRunner.query(`ALTER TABLE ${TABLE} DROP COLUMN ${column}`);
      }
    }
  }
}

module.exports = { AddPlanNoticeSettings1700000000060 };
