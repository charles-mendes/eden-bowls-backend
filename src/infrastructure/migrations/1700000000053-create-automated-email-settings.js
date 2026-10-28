const { Table } = require('typeorm');

const TABLE = 'automated_email_settings';

function toBoolean(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function integerIn(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
}

// Automated life-stage email settings per market (automated-email-settings, design decision 7). This is the only
// migration that reads the environment: it stores what LIFE_STAGE_CHANGE_EMAIL_ENABLED_<BR|US>,
// LIFE_STAGE_ANNOUNCEMENT_BATCH_SIZE and LIFE_STAGE_ANNOUNCEMENT_DAILY_CAP held at deploy time, with the defaults
// env.js used (enabled, 50, 300), so the jobs behave the same. The variables are not read after it. A row
// already present is kept.
class CreateAutomatedEmailSettings1700000000053 {
  name = 'CreateAutomatedEmailSettings1700000000053';

  constructor(env = process.env) {
    this.env = env;
  }

  async up(queryRunner) {
    if (!(await queryRunner.hasTable(TABLE))) {
      await queryRunner.createTable(new Table({
        name: TABLE,
        columns: [
          { name: 'market', type: 'varchar', length: '8', isPrimary: true },
          { name: 'life_stage_change_enabled', type: 'boolean', isNullable: false, default: true },
          { name: 'announcement_batch_size', type: 'int', unsigned: true, isNullable: false, default: 50 },
          { name: 'announcement_daily_cap', type: 'int', unsigned: true, isNullable: false, default: 300 },
          { name: 'updated_by', type: 'bigint', unsigned: true, isNullable: true },
          { name: 'created_at', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP' },
          { name: 'updated_at', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' }
        ]
      }), true);
    }
    const batch = integerIn(this.env.LIFE_STAGE_ANNOUNCEMENT_BATCH_SIZE, 1, 500, 50);
    // The cap is never below the batch, as the admin validation requires.
    const cap = Math.max(batch, integerIn(this.env.LIFE_STAGE_ANNOUNCEMENT_DAILY_CAP, 1, 5000, 300));
    for (const market of ['BR', 'US']) {
      await queryRunner.query(
        `INSERT IGNORE INTO \`${TABLE}\` (market, life_stage_change_enabled, announcement_batch_size, announcement_daily_cap)
         VALUES (?, ?, ?, ?)`,
        [market, toBoolean(this.env[`LIFE_STAGE_CHANGE_EMAIL_ENABLED_${market}`], true) ? 1 : 0, batch, cap]
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
  CreateAutomatedEmailSettings1700000000053
};
