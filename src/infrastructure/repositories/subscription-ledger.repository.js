const { HttpError } = require('../../core/http-error');
const {
  parseJsonColumn,
  toMysqlDateTime,
  fromStripeUnix
} = require('../../core/stripe-subscription-map');

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

function compact(object = {}) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined)
  );
}

function jsonOrNull(value) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  return JSON.stringify(value);
}

class SubscriptionLedgerRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tableName = options.tableName || 'stripe_subscriptions';
    this.userStateTableName = options.userStateTableName || 'onboarding_user_state';
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
      userId: Number(row.user_id),
      customerEmail: row.customer_email ? String(row.customer_email) : null,
      stripeSubscriptionId: String(row.stripe_subscription_id || ''),
      stripeCustomerId: String(row.stripe_customer_id || ''),
      status: String(row.status || ''),
      planLabel: row.plan_label ? String(row.plan_label) : null,
      stripePriceId: row.stripe_price_id ? String(row.stripe_price_id) : null,
      currentPeriodStart: row.current_period_start || null,
      currentPeriodEnd: row.current_period_end || null,
      cancelAtPeriodEnd: Boolean(Number(row.cancel_at_period_end)),
      paymentMethodLast4: row.payment_method_last4 ? String(row.payment_method_last4) : null,
      paymentMethodBrand: row.payment_method_brand ? String(row.payment_method_brand) : null,
      petsSnapshot: parseJsonColumn(row.pets_snapshot),
      planSelection: parseJsonColumn(row.plan_selection),
      shipping: parseJsonColumn(row.shipping),
      address: parseJsonColumn(row.address),
      subscriptionTermMonths: row.subscription_term_months == null ? null : Number(row.subscription_term_months),
      editPaymentPending: Boolean(Number(row.edit_payment_pending)),
      editPending: parseJsonColumn(row.edit_pending),
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null
    };
  }

  async listByUserId(userId) {
    this.ensureDataSource();
    try {
      const rows = await this.dataSource.query(
        `SELECT * FROM \`${this.tableName}\` WHERE \`user_id\` = ? ORDER BY COALESCE(\`updated_at\`, \`current_period_end\`, \`created_at\`) DESC`,
        [userId]
      );
      return (Array.isArray(rows) ? rows : []).map((row) => this.mapRow(row)).filter(Boolean);
    } catch (error) {
      if (isMissingTableError(error)) {
        return [];
      }
      throw error;
    }
  }

  async findByStripeSubscriptionId(subscriptionId) {
    this.ensureDataSource();
    const id = String(subscriptionId || '').trim();
    if (!id) {
      return null;
    }

    try {
      const rows = await this.dataSource.query(
        `SELECT * FROM \`${this.tableName}\` WHERE \`stripe_subscription_id\` = ? LIMIT 1`,
        [id]
      );
      return this.mapRow(Array.isArray(rows) ? rows[0] : null);
    } catch (error) {
      if (isMissingTableError(error)) {
        return null;
      }
      throw error;
    }
  }

  async findByUserIdAndSubscriptionId(userId, subscriptionId) {
    const row = await this.findByStripeSubscriptionId(subscriptionId);
    if (!row || Number(row.userId) !== Number(userId)) {
      return null;
    }
    return row;
  }

  async hasActiveSubscription(userId, email) {
    this.ensureDataSource();
    try {
      const byUser = await this.dataSource.query(
        `SELECT 1 AS ok FROM \`${this.tableName}\` WHERE \`user_id\` = ? AND \`status\` IN ('active', 'trialing') LIMIT 1`,
        [userId]
      );
      if (Array.isArray(byUser) && byUser.length > 0) {
        return true;
      }

      const normalizedEmail = String(email || '').trim();
      if (!normalizedEmail) {
        return false;
      }

      const byEmail = await this.dataSource.query(
        `SELECT 1 AS ok FROM \`${this.tableName}\` WHERE \`customer_email\` = ? AND \`status\` IN ('active', 'trialing') LIMIT 1`,
        [normalizedEmail]
      );
      return Array.isArray(byEmail) && byEmail.length > 0;
    } catch (error) {
      if (isMissingTableError(error)) {
        return null;
      }
      throw error;
    }
  }

  async findUserStateBySubscriptionId(subscriptionId) {
    this.ensureDataSource();
    const id = String(subscriptionId || '').trim();
    if (!id) {
      return null;
    }

    try {
      const rows = await this.dataSource.query(
        `SELECT \`user_id\`, \`checkout_reference\`, \`plan_selection\`, \`address\`, \`shipping\` FROM \`${this.userStateTableName}\` WHERE JSON_UNQUOTE(JSON_EXTRACT(\`checkout_reference\`, '$.stripe_subscription_id')) = ? LIMIT 1`,
        [id]
      );
      const row = Array.isArray(rows) ? rows[0] : null;
      if (!row) {
        return null;
      }
      return {
        userId: Number(row.user_id),
        checkoutReference: parseJsonColumn(row.checkout_reference),
        planSelection: parseJsonColumn(row.plan_selection),
        address: parseJsonColumn(row.address),
        shipping: parseJsonColumn(row.shipping)
      };
    } catch (error) {
      if (isMissingTableError(error)) {
        return null;
      }
      throw error;
    }
  }

  async findUserStateByPaymentIntentId(paymentIntentId) {
    this.ensureDataSource();
    const id = String(paymentIntentId || '').trim();
    if (!id) {
      return null;
    }

    try {
      const rows = await this.dataSource.query(
        `SELECT \`user_id\`, \`checkout_reference\` FROM \`${this.userStateTableName}\` WHERE JSON_UNQUOTE(JSON_EXTRACT(\`checkout_reference\`, '$.stripe_payment_intent_id')) = ? LIMIT 1`,
        [id]
      );
      const row = Array.isArray(rows) ? rows[0] : null;
      if (!row) {
        return null;
      }
      return {
        userId: Number(row.user_id),
        checkoutReference: parseJsonColumn(row.checkout_reference)
      };
    } catch (error) {
      if (isMissingTableError(error)) {
        return null;
      }
      throw error;
    }
  }

  async findUserStateByUserId(userId) {
    this.ensureDataSource();
    try {
      const rows = await this.dataSource.query(
        `SELECT \`plan_selection\`, \`address\`, \`shipping\`, \`checkout_reference\` FROM \`${this.userStateTableName}\` WHERE \`user_id\` = ? LIMIT 1`,
        [userId]
      );
      const row = Array.isArray(rows) ? rows[0] : null;
      if (!row) {
        return null;
      }
      return {
        planSelection: parseJsonColumn(row.plan_selection),
        address: parseJsonColumn(row.address),
        shipping: parseJsonColumn(row.shipping),
        checkoutReference: parseJsonColumn(row.checkout_reference)
      };
    } catch (error) {
      if (isMissingTableError(error)) {
        return null;
      }
      throw error;
    }
  }

  async updateCheckoutReference(userId, patch = {}) {
    this.ensureDataSource();
    const rows = await this.dataSource.query(
      `SELECT \`checkout_reference\` FROM \`${this.userStateTableName}\` WHERE \`user_id\` = ? LIMIT 1`,
      [userId]
    );
    const current = parseJsonColumn(Array.isArray(rows) && rows[0] ? rows[0].checkout_reference : null) || {};
    const next = { ...current, ...compact(patch) };
    await this.dataSource.query(
      `UPDATE \`${this.userStateTableName}\` SET \`checkout_reference\` = ? WHERE \`user_id\` = ?`,
      [JSON.stringify(next), userId]
    );
    return next;
  }

  periodValue(value) {
    if (value == null || value === '') {
      return undefined;
    }
    if (typeof value === 'number') {
      return fromStripeUnix(value);
    }
    return toMysqlDateTime(value);
  }

  async upsert(input = {}) {
    this.ensureDataSource();
    const subscriptionId = String(input.stripeSubscriptionId || '').trim();
    if (!subscriptionId.startsWith('sub_')) {
      throw new HttpError(422, 'Invalid subscription id.', { code: 'invalid_subscription_id' });
    }

    const existing = await this.findByStripeSubscriptionId(subscriptionId);
    const next = {
      ...(existing || {}),
      ...compact({
        userId: input.userId == null ? undefined : Number(input.userId),
        customerEmail: input.customerEmail === undefined ? undefined : (input.customerEmail || null),
        stripeSubscriptionId: subscriptionId,
        stripeCustomerId: input.stripeCustomerId,
        status: input.status,
        planLabel: input.planLabel,
        stripePriceId: input.stripePriceId,
        currentPeriodStart: this.periodValue(input.currentPeriodStart),
        currentPeriodEnd: this.periodValue(input.currentPeriodEnd),
        cancelAtPeriodEnd: input.cancelAtPeriodEnd == null ? undefined : (input.cancelAtPeriodEnd ? 1 : 0),
        paymentMethodLast4: input.paymentMethodLast4,
        paymentMethodBrand: input.paymentMethodBrand,
        petsSnapshot: input.petsSnapshot,
        planSelection: input.planSelection,
        shipping: input.shipping,
        address: input.address,
        subscriptionTermMonths: input.subscriptionTermMonths,
        editPaymentPending: input.editPaymentPending == null ? undefined : (input.editPaymentPending ? 1 : 0),
        editPending: input.editPending === undefined ? undefined : input.editPending
      })
    };

    if (!next.userId || !next.stripeCustomerId || !next.status) {
      throw new HttpError(422, 'Incomplete subscription ledger row.', { code: 'invalid_ledger_row' });
    }

    const params = [
      next.userId,
      next.customerEmail || null,
      subscriptionId,
      next.stripeCustomerId,
      next.status,
      next.planLabel || null,
      next.stripePriceId || null,
      next.currentPeriodStart || null,
      next.currentPeriodEnd || null,
      next.cancelAtPeriodEnd ? 1 : 0,
      next.paymentMethodLast4 || null,
      next.paymentMethodBrand || null,
      jsonOrNull(next.petsSnapshot) || null,
      jsonOrNull(next.planSelection) || null,
      jsonOrNull(next.shipping) || null,
      jsonOrNull(next.address) || null,
      next.subscriptionTermMonths == null ? null : Number(next.subscriptionTermMonths),
      next.editPaymentPending ? 1 : 0,
      jsonOrNull(next.editPending) || null
    ];

    await this.dataSource.query(
      `INSERT INTO \`${this.tableName}\` (
        \`user_id\`, \`customer_email\`, \`stripe_subscription_id\`, \`stripe_customer_id\`,
        \`status\`, \`plan_label\`, \`stripe_price_id\`, \`current_period_start\`, \`current_period_end\`,
        \`cancel_at_period_end\`, \`payment_method_last4\`, \`payment_method_brand\`,
        \`pets_snapshot\`, \`plan_selection\`, \`shipping\`, \`address\`, \`subscription_term_months\`,
        \`edit_payment_pending\`, \`edit_pending\`
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        \`user_id\` = VALUES(\`user_id\`),
        \`customer_email\` = VALUES(\`customer_email\`),
        \`stripe_customer_id\` = VALUES(\`stripe_customer_id\`),
        \`status\` = VALUES(\`status\`),
        \`plan_label\` = VALUES(\`plan_label\`),
        \`stripe_price_id\` = VALUES(\`stripe_price_id\`),
        \`current_period_start\` = VALUES(\`current_period_start\`),
        \`current_period_end\` = VALUES(\`current_period_end\`),
        \`cancel_at_period_end\` = VALUES(\`cancel_at_period_end\`),
        \`payment_method_last4\` = VALUES(\`payment_method_last4\`),
        \`payment_method_brand\` = VALUES(\`payment_method_brand\`),
        \`pets_snapshot\` = VALUES(\`pets_snapshot\`),
        \`plan_selection\` = VALUES(\`plan_selection\`),
        \`shipping\` = VALUES(\`shipping\`),
        \`address\` = VALUES(\`address\`),
        \`subscription_term_months\` = VALUES(\`subscription_term_months\`),
        \`edit_payment_pending\` = VALUES(\`edit_payment_pending\`),
        \`edit_pending\` = VALUES(\`edit_pending\`)`,
      params
    );

    return this.findByStripeSubscriptionId(subscriptionId);
  }

  async findById(id) {
    this.ensureDataSource();
    const numericId = Number(id);
    if (!Number.isSafeInteger(numericId) || numericId < 1) {
      return null;
    }

    try {
      const rows = await this.dataSource.query(
        `SELECT * FROM \`${this.tableName}\` WHERE \`id\` = ? LIMIT 1`,
        [numericId]
      );
      return this.mapRow(Array.isArray(rows) ? rows[0] : null);
    } catch (error) {
      if (isMissingTableError(error)) {
        return null;
      }
      throw error;
    }
  }

  async listAdmin({ status, q, offset, perPage }) {
    this.ensureDataSource();
    const where = [];
    const params = [];
    const normalizedStatus = String(status || 'active').trim();

    if (normalizedStatus === 'canceling') {
      where.push("`cancel_at_period_end` = 1 AND `status` IN ('active', 'trialing', 'past_due')");
    } else if (normalizedStatus && normalizedStatus !== 'all') {
      where.push('`status` = ?');
      params.push(normalizedStatus);
    }

    if (q) {
      const needle = `%${String(q).trim()}%`;
      where.push('(`stripe_subscription_id` LIKE ? OR `stripe_customer_id` LIKE ? OR `customer_email` LIKE ? OR CAST(`user_id` AS CHAR) LIKE ?)');
      params.push(needle, needle, needle, needle);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    try {
      const countRows = await this.dataSource.query(
        `SELECT COUNT(*) AS total FROM \`${this.tableName}\` ${whereSql}`,
        params
      );
      const total = Number(Array.isArray(countRows) && countRows[0] ? countRows[0].total : 0);
      const rows = await this.dataSource.query(
        [
          `SELECT * FROM \`${this.tableName}\``,
          whereSql,
          'ORDER BY COALESCE(`updated_at`, `created_at`) DESC',
          'LIMIT ? OFFSET ?'
        ].join(' '),
        [...params, perPage, offset]
      );

      return {
        total,
        items: (Array.isArray(rows) ? rows : []).map((row) => this.mapRow(row)).filter(Boolean)
      };
    } catch (error) {
      if (isMissingTableError(error)) {
        return { total: 0, items: [] };
      }
      throw error;
    }
  }

  async metrics() {
    this.ensureDataSource();
    const now = new Date();
    const in7d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const ago30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    try {
      const rows = await this.dataSource.query(`SELECT * FROM \`${this.tableName}\``);
      const items = (Array.isArray(rows) ? rows : []).map((row) => this.mapRow(row)).filter(Boolean);
      const isCanceling = (item) => item.cancelAtPeriodEnd && ['active', 'trialing', 'past_due'].includes(item.status);
      const periodEnd = (item) => item.currentPeriodEnd ? new Date(item.currentPeriodEnd) : null;

      return {
        total: items.length,
        active: items.filter((item) => item.status === 'active' || item.status === 'trialing').length,
        canceling: items.filter(isCanceling).length,
        pastDue: items.filter((item) => item.status === 'past_due').length,
        canceled30d: items.filter((item) => item.status === 'canceled' && item.updatedAt && new Date(item.updatedAt) >= ago30d).length,
        renewing7d: items.filter((item) => {
          const end = periodEnd(item);
          return end && end > now && end <= in7d && ['active', 'trialing', 'past_due'].includes(item.status);
        }).length,
        mrr: 0,
        invoices30d: 0,
        generatedAt: now.toISOString()
      };
    } catch (error) {
      if (isMissingTableError(error)) {
        return {
          total: 0,
          active: 0,
          canceling: 0,
          pastDue: 0,
          canceled30d: 0,
          renewing7d: 0,
          mrr: 0,
          invoices30d: 0,
          generatedAt: now.toISOString()
        };
      }
      throw error;
    }
  }

  async backfillUserLinks(usersRepository) {
    this.ensureDataSource();
    const rows = await this.dataSource.query(
      `SELECT \`id\`, \`customer_email\`, \`user_id\` FROM \`${this.tableName}\` WHERE \`user_id\` IS NULL OR \`user_id\` = 0`
    );
    let linked = 0;

    for (const row of Array.isArray(rows) ? rows : []) {
      if (!row.customer_email || typeof usersRepository.findUserIdByEmail !== 'function') {
        continue;
      }
      const userId = await usersRepository.findUserIdByEmail(row.customer_email);
      if (!userId) {
        continue;
      }
      await this.dataSource.query(
        `UPDATE \`${this.tableName}\` SET \`user_id\` = ? WHERE \`id\` = ?`,
        [userId, row.id]
      );
      linked += 1;
    }

    return { linked };
  }
}

module.exports = {
  SubscriptionLedgerRepository
};
