const { HttpError } = require('../../core/http-error');
const { DEFAULT_AUTOMATED_EMAIL_SETTINGS } = require('../../core/automated-email-settings');

function isMissingTableError(error) {
  const message = String(error && error.message ? error.message : '');
  return message.includes('ER_NO_SUCH_TABLE') || message.includes("doesn't exist");
}

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(`${String(value).replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// Automated life-stage email settings per market (automated-email-settings). Read without a cache: the jobs
// read the row at the start of each run, so a change applies to the next run in any process.
class AutomatedEmailSettingsRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tableName = options.tableName || 'automated_email_settings';
  }

  ensureDataSource() {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }
  }

  async forMarket(market) {
    this.ensureDataSource();
    let rows = [];
    try {
      rows = await this.dataSource.query(
        `SELECT life_stage_change_enabled, announcement_batch_size, announcement_daily_cap, updated_by, updated_at
         FROM \`${this.tableName}\` WHERE market = ? LIMIT 1`,
        [String(market || '').toUpperCase()]
      );
    } catch (error) {
      if (!isMissingTableError(error)) {
        throw error;
      }
    }
    const row = Array.isArray(rows) && rows[0];
    if (!row) {
      return { ...DEFAULT_AUTOMATED_EMAIL_SETTINGS, updatedBy: null, updatedAt: null };
    }
    return {
      lifeStageChangeEnabled: Boolean(Number(row.life_stage_change_enabled)),
      announcementBatchSize: Number(row.announcement_batch_size),
      announcementDailyCap: Number(row.announcement_daily_cap),
      updatedBy: row.updated_by == null ? null : Number(row.updated_by),
      updatedAt: toIso(row.updated_at)
    };
  }

  async save(market, settings, actorId = null, manager = this.dataSource) {
    this.ensureDataSource();
    await manager.query(
      `INSERT INTO \`${this.tableName}\` (market, life_stage_change_enabled, announcement_batch_size, announcement_daily_cap, updated_by)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE life_stage_change_enabled = VALUES(life_stage_change_enabled),
         announcement_batch_size = VALUES(announcement_batch_size), announcement_daily_cap = VALUES(announcement_daily_cap),
         updated_by = VALUES(updated_by)`,
      [String(market || '').toUpperCase(), settings.lifeStageChangeEnabled ? 1 : 0, settings.announcementBatchSize,
        settings.announcementDailyCap, actorId]
    );
  }
}

module.exports = {
  AutomatedEmailSettingsRepository
};
