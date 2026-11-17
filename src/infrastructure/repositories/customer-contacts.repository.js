const { HttpError } = require('../../core/http-error');

function rowsOf(result) {
  return Array.isArray(result) ? result : [];
}

// customer_contacts (customer-contacts): written once, read newest first, deleted with the customer's account.
class CustomerContactsRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tableName = options.tableName || 'customer_contacts';
  }

  ensureDataSource() {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }
  }

  mapRow(row) {
    if (!row) return null;
    return {
      id: Number(row.id),
      subscription_id: String(row.subscription_id),
      user_id: row.user_id == null ? null : Number(row.user_id),
      stripe_account: row.stripe_account || null,
      reason: row.reason,
      outcome: row.outcome,
      note: row.note || null,
      actor_id: row.actor_id == null ? null : Number(row.actor_id),
      actor_email: row.actor_email || null,
      created_at: row.created_at || null
    };
  }

  async insert({ subscriptionId, userId = null, stripeAccount = null, reason, outcome, note = null, actorId = null, actorEmail = null, createdAt = new Date() }) {
    this.ensureDataSource();
    const result = await this.dataSource.query(
      `INSERT INTO \`${this.tableName}\` (subscription_id, user_id, stripe_account, reason, outcome, note, actor_id, actor_email, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [String(subscriptionId), userId == null ? null : Number(userId), stripeAccount, reason, outcome, note, actorId == null ? null : Number(actorId), actorEmail, createdAt]
    );
    const id = result && (result.insertId || (Array.isArray(result) && result[0] && result[0].insertId));
    return this.findById(id);
  }

  async findById(id) {
    this.ensureDataSource();
    const [row] = rowsOf(await this.dataSource.query(`SELECT * FROM \`${this.tableName}\` WHERE id = ? LIMIT 1`, [Number(id)]));
    return this.mapRow(row);
  }

  async listBySubscription(subscriptionId, limit = 50) {
    this.ensureDataSource();
    const rows = await this.dataSource.query(
      `SELECT * FROM \`${this.tableName}\` WHERE subscription_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
      [String(subscriptionId), Number(limit)]
    );
    return rowsOf(rows).map((row) => this.mapRow(row));
  }

  // The newest contact of each subscription, for Today.
  async latestBySubscriptions(subscriptionIds = []) {
    this.ensureDataSource();
    const ids = [...new Set((subscriptionIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
    const latest = new Map();
    if (!ids.length) return latest;
    const rows = await this.dataSource.query(
      `SELECT c.* FROM \`${this.tableName}\` c
       JOIN (SELECT subscription_id, MAX(id) AS id FROM \`${this.tableName}\` WHERE subscription_id IN (${ids.map(() => '?').join(', ')}) GROUP BY subscription_id) last
         ON last.id = c.id`,
      ids
    );
    for (const row of rowsOf(rows)) {
      const mapped = this.mapRow(row);
      latest.set(mapped.subscription_id, mapped);
    }
    return latest;
  }

  async listByUser(userId) {
    this.ensureDataSource();
    const rows = await this.dataSource.query(
      `SELECT * FROM \`${this.tableName}\` WHERE user_id = ? ORDER BY created_at DESC, id DESC`,
      [Number(userId)]
    );
    return rowsOf(rows).map((row) => this.mapRow(row));
  }

  async deleteByUser(userId) {
    this.ensureDataSource();
    await this.dataSource.query(`DELETE FROM \`${this.tableName}\` WHERE user_id = ?`, [Number(userId)]);
  }
}

module.exports = { CustomerContactsRepository };
