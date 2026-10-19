const { HttpError } = require('../../core/http-error');

// Customer-side state of a stage transition per subscription and pet (design decision 7).
class PetLifeStageNoticesRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tableName = options.tableName || 'pet_life_stage_notices';
  }

  ensureDataSource() {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }
  }

  // Opens the notice of a transition already notified (a confirmed correction or the launch announcement).
  // A row notified earlier keeps its first notification.
  async upsertNotified({ subscriptionId, petId, fromLine, toLine, via, at }) {
    this.ensureDataSource();
    await this.dataSource.query(
      `INSERT INTO \`${this.tableName}\` (subscription_id, pet_id, from_line, to_line, detected_at, notified_at, notified_via)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE notified_at = COALESCE(notified_at, VALUES(notified_at)),
         notified_via = COALESCE(notified_via, VALUES(notified_via))`,
      [subscriptionId, petId, fromLine, toLine, at, at, via]
    );
  }
}

module.exports = {
  PetLifeStageNoticesRepository
};
