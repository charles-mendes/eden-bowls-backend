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

// MySQL DATE columns come back as a Date at UTC midnight or as text; both become YYYY-MM-DD.
function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
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
      paidAt: row.paid_at || null,
      paidInvoiceId: row.paid_invoice_id ? String(row.paid_invoice_id) : null,
      preparationDay: dateOnly(row.preparation_day),
      deliveryDate: dateOnly(row.delivery_date),
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

  // Records the payment of one cycle. A repeated invoice.paid keeps the first payment and the status.
  async markPaid({ subscriptionId, periodEnd, paidAt, invoiceId, preparationDay, deliveryDate }) {
    this.ensureDataSource();
    const numericId = Number(subscriptionId);
    const period = toMysqlDateTime(periodEnd);
    const paid = toMysqlDateTime(paidAt);
    if (!Number.isSafeInteger(numericId) || numericId < 1 || !period || !paid) {
      throw new HttpError(422, 'Invalid production cycle payment.');
    }
    await this.dataSource.query(
      `INSERT INTO \`${this.tableName}\`
        (\`subscription_id\`, \`period_end\`, \`status\`, \`paid_at\`, \`paid_invoice_id\`, \`preparation_day\`, \`delivery_date\`)
        VALUES (?, ?, 'to_prepare', ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          \`paid_invoice_id\` = IF(\`paid_at\` IS NULL, VALUES(\`paid_invoice_id\`), \`paid_invoice_id\`),
          \`preparation_day\` = IF(\`paid_at\` IS NULL, VALUES(\`preparation_day\`), \`preparation_day\`),
          \`delivery_date\` = IF(\`paid_at\` IS NULL, VALUES(\`delivery_date\`), \`delivery_date\`),
          \`paid_at\` = IF(\`paid_at\` IS NULL, VALUES(\`paid_at\`), \`paid_at\`)`,
      [numericId, period, paid, invoiceId || null, preparationDay || null, deliveryDate || null]
    );
    return this.findBySubscriptionAndPeriodEnd(numericId, period);
  }

  // Re-keys an unpaid cycle to the charge it moved to. `preparationDay` keeps the day it had before a block.
  async moveCycle({ subscriptionId, from, to, preparationDay = null }) {
    this.ensureDataSource();
    const numericId = Number(subscriptionId);
    const fromKey = toMysqlDateTime(from);
    const toKey = toMysqlDateTime(to);
    if (!Number.isSafeInteger(numericId) || numericId < 1 || !fromKey || !toKey) {
      throw new HttpError(422, 'Invalid production cycle identity.');
    }
    await this.dataSource.query(
      `UPDATE \`${this.tableName}\` SET \`period_end\` = ?, \`preparation_day\` = ?
        WHERE \`subscription_id\` = ? AND \`period_end\` = ? AND \`paid_at\` IS NULL`,
      [toKey, preparationDay, numericId, fromKey]
    );
    return this.findBySubscriptionAndPeriodEnd(numericId, toKey);
  }

  // The paid delivery the customer is still waiting for: delivered today or later.
  async findOpenPaidCycle(subscriptionId, today) {
    this.ensureDataSource();
    const numericId = Number(subscriptionId);
    if (!Number.isSafeInteger(numericId) || numericId < 1 || !today) {
      return null;
    }
    try {
      const rows = await this.dataSource.query(
        `SELECT * FROM \`${this.tableName}\`
          WHERE \`subscription_id\` = ? AND \`paid_at\` IS NOT NULL AND \`delivery_date\` >= ?
          ORDER BY \`period_end\` DESC LIMIT 1`,
        [numericId, today]
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
  SubscriptionProductionRepository,
  dateOnly
};
