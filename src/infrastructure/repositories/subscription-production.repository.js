const { HttpError } = require('../../core/http-error');
const { toMysqlDateTime } = require('../../core/stripe-subscription-map');

function isMissingTableError(error) {
  const message = String(error && error.message ? error.message : '');
  return Boolean(
    error && (
      error.code === 'ER_NO_SUCH_TABLE' ||
      error.errno === 1146 ||
      /doesn't exist/i.test(message)
    )
  );
}

class SubscriptionProductionRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tableName = options.tableName || 'subscription_production_cycles';
  }

  ensureDataSource() {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }
  }

  mapRow(row) {
    if (!row) {
      return null;
    }

    return {
      id: Number(row.id),
      subscriptionId: Number(row.subscription_id),
      periodEnd: row.period_end || null,
      status: String(row.status || 'to_prepare'),
      note: row.note ? String(row.note) : null,
      updatedByUserId: row.updated_by_user_id == null ? null : Number(row.updated_by_user_id),
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null
    };
  }

  async findBySubscriptionAndPeriodEnd(subscriptionId, periodEnd) {
    this.ensureDataSource();
    const numericId = Number(subscriptionId);
    const period = toMysqlDateTime(periodEnd);
    if (!Number.isSafeInteger(numericId) || numericId < 1 || !period) {
      return null;
    }

    try {
      const rows = await this.dataSource.query(
        `SELECT * FROM \`${this.tableName}\` WHERE \`subscription_id\` = ? AND \`period_end\` = ? LIMIT 1`,
        [numericId, period]
      );
      return this.mapRow(Array.isArray(rows) ? rows[0] : null);
    } catch (error) {
      if (isMissingTableError(error)) {
        return null;
      }
      throw error;
    }
  }

  async upsert({ subscriptionId, periodEnd, status, note, updatedByUserId }) {
    this.ensureDataSource();
    const numericId = Number(subscriptionId);
    const period = toMysqlDateTime(periodEnd);
    if (!Number.isSafeInteger(numericId) || numericId < 1 || !period) {
      throw new HttpError(422, 'Invalid production cycle identity.');
    }

    const existing = await this.findBySubscriptionAndPeriodEnd(numericId, period);
    const params = [
      String(status || 'to_prepare'),
      note == null || note === '' ? null : String(note),
      updatedByUserId == null ? null : Number(updatedByUserId)
    ];

    try {
      if (existing) {
        await this.dataSource.query(
          `UPDATE \`${this.tableName}\` SET \`status\` = ?, \`note\` = ?, \`updated_by_user_id\` = ? WHERE \`subscription_id\` = ? AND \`period_end\` = ?`,
          [...params, numericId, period]
        );
      } else {
        await this.dataSource.query(
          `INSERT INTO \`${this.tableName}\` (\`subscription_id\`, \`period_end\`, \`status\`, \`note\`, \`updated_by_user_id\`) VALUES (?, ?, ?, ?, ?)`,
          [numericId, period, ...params]
        );
      }
    } catch (error) {
      if (isMissingTableError(error)) {
        throw new HttpError(503, 'Production cycles table is not available.', {
          code: 'subscription_production_cycles_missing'
        });
      }
      throw error;
    }

    return this.findBySubscriptionAndPeriodEnd(numericId, period);
  }
}

module.exports = {
  SubscriptionProductionRepository
};
