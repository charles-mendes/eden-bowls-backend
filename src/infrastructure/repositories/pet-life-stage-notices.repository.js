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

// First detection of a mismatch. An existing row is left as it is; `notified` copies a launch announcement.
PetLifeStageNoticesRepository.prototype.ensureDetected = async function ensureDetected({ subscriptionId, petId, fromLine, toLine, at, notified = null }) {
  this.ensureDataSource();
  await this.dataSource.query(
    `INSERT INTO \`${this.tableName}\` (subscription_id, pet_id, from_line, to_line, detected_at, notified_at, notified_via)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = id`,
    [subscriptionId, petId, fromLine, toLine, at, notified ? notified.at : null, notified ? notified.via : null]
  );
};

PetLifeStageNoticesRepository.prototype.listForSubscriptions = async function listForSubscriptions(subscriptionIds) {
  const ids = [...new Set((subscriptionIds || []).map(Number).filter((id) => id > 0))];
  if (ids.length === 0) {
    return [];
  }
  this.ensureDataSource();
  const rows = await this.dataSource.query(
    `SELECT subscription_id, pet_id, from_line, to_line, detected_at, dismissed_at, resolved_at, notified_at, notified_via
     FROM \`${this.tableName}\` WHERE subscription_id IN (${ids.map(() => '?').join(', ')})`,
    ids
  );
  return Array.isArray(rows) ? rows : [];
};

// Closing a notice: it does not come back for the same transition.
PetLifeStageNoticesRepository.prototype.dismissOpen = async function dismissOpen(subscriptionId, petId, at) {
  this.ensureDataSource();
  const result = await this.dataSource.query(
    `UPDATE \`${this.tableName}\` SET dismissed_at = ?
     WHERE subscription_id = ? AND pet_id = ? AND dismissed_at IS NULL AND resolved_at IS NULL`,
    [at, subscriptionId, petId]
  );
  return Number(result && result.affectedRows) || 0;
};

// A saved adjustment of the plan, keeping the previous line or switching, closes its open notices.
PetLifeStageNoticesRepository.prototype.resolveOpen = async function resolveOpen(subscriptionId, at) {
  this.ensureDataSource();
  await this.dataSource.query(
    `UPDATE \`${this.tableName}\` SET resolved_at = ?
     WHERE subscription_id = ? AND dismissed_at IS NULL AND resolved_at IS NULL`,
    [at, subscriptionId]
  );
};

// Whether any subscription already notified this pet of this transition (one email per pet transition).
PetLifeStageNoticesRepository.prototype.transitionNotified = async function transitionNotified(petId, fromLine, toLine) {
  this.ensureDataSource();
  const rows = await this.dataSource.query(
    `SELECT 1 FROM \`${this.tableName}\`
     WHERE pet_id = ? AND from_line = ? AND to_line = ? AND notified_at IS NOT NULL LIMIT 1`,
    [petId, fromLine, toLine]
  );
  return Array.isArray(rows) && rows.length > 0;
};

// The stage-change email went out: the transition is never emailed again.
PetLifeStageNoticesRepository.prototype.markEmailed = async function markEmailed({ subscriptionId, petId, fromLine, toLine, at }) {
  this.ensureDataSource();
  await this.dataSource.query(
    `UPDATE \`${this.tableName}\` SET notified_at = ?, notified_via = 'email'
     WHERE subscription_id = ? AND pet_id = ? AND from_line = ? AND to_line = ? AND notified_at IS NULL`,
    [at, subscriptionId, petId, fromLine, toLine]
  );
};

// The launch announcement named the pet for this stage: its open notices count as notified (they still show).
PetLifeStageNoticesRepository.prototype.markAnnounced = async function markAnnounced(petId, stage, at) {
  this.ensureDataSource();
  await this.dataSource.query(
    `UPDATE \`${this.tableName}\` SET notified_at = ?, notified_via = 'announcement'
     WHERE pet_id = ? AND to_line = ? AND notified_at IS NULL AND dismissed_at IS NULL AND resolved_at IS NULL`,
    [at, petId, stage]
  );
};

module.exports = {
  PetLifeStageNoticesRepository
};
