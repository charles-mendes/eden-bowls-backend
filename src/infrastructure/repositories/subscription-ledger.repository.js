const { HttpError } = require('../../core/http-error');
const {
  parseJsonColumn,
  toMysqlDateTime,
  fromStripeUnix
} = require('../../core/stripe-subscription-map');
const { PROFILE_MARKET_META_KEY, appendInFilter } = require('../../core/admin-market-scope');

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
    this.usermetaTableName = options.usermetaTableName || 'wp_usermeta';
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
      stripeAccount: String(row.stripe_account || 'us').toLowerCase() || 'us',
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
      updatedAt: row.updated_at || null,
      profileMarket: row.profile_market ? String(row.profile_market).trim().toUpperCase() : ''
    };
  }

  profileMarketJoinSql() {
    return `LEFT JOIN \`${this.usermetaTableName}\` pm ON pm.user_id = s.user_id AND pm.meta_key = '${PROFILE_MARKET_META_KEY}'`;
  }

  async listByUserId(userId, options = {}) {
    this.ensureDataSource();
    try {
      const where = ['s.`user_id` = ?'];
      const params = [userId];
      if (Array.isArray(options.stripeAccounts) && options.stripeAccounts.length) {
        appendInFilter(where, params, 's.`stripe_account`', options.stripeAccounts);
      }
      const rows = await this.dataSource.query(
        [
          `SELECT s.*, pm.meta_value AS profile_market`,
          `FROM \`${this.tableName}\` s`,
          this.profileMarketJoinSql(),
          `WHERE ${where.join(' AND ')}`,
          'ORDER BY COALESCE(s.`updated_at`, s.`current_period_end`, s.`created_at`) DESC'
        ].join(' '),
        params
      );
      return (Array.isArray(rows) ? rows : []).map((row) => this.mapRow(row)).filter(Boolean);
    } catch (error) {
      if (isMissingTableError(error)) {
        return [];
      }
      throw error;
    }
  }

  async redactCustomerEmailForUser(userId) {
    this.ensureDataSource();
    const normalizedUserId = Number(userId);
    if (!Number.isSafeInteger(normalizedUserId) || normalizedUserId < 1) {
      return 0;
    }
    try {
      const result = await this.dataSource.query(
        `UPDATE \`${this.tableName}\` SET \`customer_email\` = NULL WHERE \`user_id\` = ?`,
        [normalizedUserId]
      );
      return Number(result && result.affectedRows || 0);
    } catch (error) {
      if (isMissingTableError(error)) {
        return 0;
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
        stripeAccount: input.stripeAccount,
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
      next.stripeAccount || 'us',
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
        \`stripe_account\`, \`status\`, \`plan_label\`, \`stripe_price_id\`, \`current_period_start\`, \`current_period_end\`,
        \`cancel_at_period_end\`, \`payment_method_last4\`, \`payment_method_brand\`,
        \`pets_snapshot\`, \`plan_selection\`, \`shipping\`, \`address\`, \`subscription_term_months\`,
        \`edit_payment_pending\`, \`edit_pending\`
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        \`user_id\` = VALUES(\`user_id\`),
        \`customer_email\` = VALUES(\`customer_email\`),
        \`stripe_customer_id\` = VALUES(\`stripe_customer_id\`),
        \`stripe_account\` = VALUES(\`stripe_account\`),
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
        [
          `SELECT s.*, pm.meta_value AS profile_market`,
          `FROM \`${this.tableName}\` s`,
          this.profileMarketJoinSql(),
          'WHERE s.`id` = ? LIMIT 1'
        ].join(' '),
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

  async listAdmin({ status, q, stripeAccount, stripeAccounts, offset, perPage }) {
    this.ensureDataSource();
    const where = [];
    const params = [];
    const normalizedStatus = String(status || 'active').trim();

    if (normalizedStatus === 'canceling') {
      where.push("s.`cancel_at_period_end` = 1 AND s.`status` IN ('active', 'trialing', 'past_due')");
    } else if (normalizedStatus && normalizedStatus !== 'all') {
      where.push('s.`status` = ?');
      params.push(normalizedStatus);
    }

    const accounts = Array.isArray(stripeAccounts) && stripeAccounts.length
      ? stripeAccounts.map((item) => String(item).trim().toLowerCase()).filter(Boolean)
      : (stripeAccount ? [String(stripeAccount).trim().toLowerCase()] : []);
    if (accounts.length) {
      appendInFilter(where, params, 's.`stripe_account`', accounts);
    }

    if (q) {
      const needle = `%${String(q).trim()}%`;
      where.push('(s.`stripe_subscription_id` LIKE ? OR s.`stripe_customer_id` LIKE ? OR s.`customer_email` LIKE ? OR CAST(s.`user_id` AS CHAR) LIKE ?)');
      params.push(needle, needle, needle, needle);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    try {
      const countRows = await this.dataSource.query(
        `SELECT COUNT(*) AS total FROM \`${this.tableName}\` s ${whereSql}`,
        params
      );
      const total = Number(Array.isArray(countRows) && countRows[0] ? countRows[0].total : 0);
      const rows = await this.dataSource.query(
        [
          `SELECT s.*, pm.meta_value AS profile_market`,
          `FROM \`${this.tableName}\` s`,
          this.profileMarketJoinSql(),
          whereSql,
          'ORDER BY COALESCE(s.`updated_at`, s.`created_at`) DESC',
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

  async metrics({ stripeAccounts } = {}) {
    this.ensureDataSource();
    const now = new Date();
    const in7d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const ago30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const where = [];
    const params = [];
    if (Array.isArray(stripeAccounts) && stripeAccounts.length) {
      appendInFilter(where, params, '`stripe_account`', stripeAccounts.map((item) => String(item).trim().toLowerCase()));
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    try {
      const rows = await this.dataSource.query(
        [
          'SELECT',
          'COUNT(*) AS total,',
          "SUM(CASE WHEN `status` IN ('active', 'trialing') THEN 1 ELSE 0 END) AS active,",
          "SUM(CASE WHEN `cancel_at_period_end` = 1 AND `status` IN ('active', 'trialing', 'past_due') THEN 1 ELSE 0 END) AS canceling,",
          "SUM(CASE WHEN `status` = 'past_due' THEN 1 ELSE 0 END) AS pastDue,",
          "SUM(CASE WHEN `status` = 'canceled' AND `updated_at` IS NOT NULL AND `updated_at` >= ? THEN 1 ELSE 0 END) AS canceled30d,",
          "SUM(CASE WHEN `current_period_end` IS NOT NULL AND `current_period_end` > ? AND `current_period_end` <= ? AND `status` IN ('active', 'trialing', 'past_due') THEN 1 ELSE 0 END) AS renewing7d",
          `FROM \`${this.tableName}\``,
          whereSql
        ].join(' '),
        [toMysqlDateTime(ago30d), toMysqlDateTime(now), toMysqlDateTime(in7d), ...params]
      );
      const row = Array.isArray(rows) ? rows[0] : null;
      return {
        total: Number(row && row.total || 0),
        active: Number(row && row.active || 0),
        canceling: Number(row && row.canceling || 0),
        pastDue: Number(row && row.pastDue || 0),
        canceled30d: Number(row && row.canceled30d || 0),
        renewing7d: Number(row && row.renewing7d || 0),
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

  queueJoinSql() {
    return [
      `FROM \`${this.tableName}\` s`,
      'LEFT JOIN `subscription_production_cycles` c ON c.subscription_id = s.id AND c.period_end = s.current_period_end',
      this.profileMarketJoinSql()
    ].join(' ');
  }

  queueMembership({ startOfToday, windowEndExclusive, overdueFloor, includeOverdue, account, stripeAccounts, productionStatus, q }) {
    const where = [
      "s.status IN ('active','trialing','past_due')",
      's.cancel_at_period_end = 0',
      's.current_period_end IS NOT NULL',
      `(
        (s.current_period_end >= ? AND s.current_period_end < ?)
        OR (
          ? AND s.current_period_end >= ? AND s.current_period_end < ?
          AND COALESCE(c.status,'to_prepare') <> 'ready'
        )
      )`
    ];
    const params = [
      startOfToday,
      windowEndExclusive,
      includeOverdue ? 1 : 0,
      overdueFloor,
      startOfToday
    ];

    const accounts = Array.isArray(stripeAccounts) && stripeAccounts.length
      ? stripeAccounts.map((item) => String(item).trim().toLowerCase()).filter(Boolean)
      : (account ? [String(account).trim().toLowerCase()] : []);
    if (accounts.length) {
      appendInFilter(where, params, 's.stripe_account', accounts);
    }

    if (productionStatus) {
      where.push("COALESCE(c.status,'to_prepare') = ?");
      params.push(String(productionStatus));
    }

    if (q) {
      const needle = `%${String(q).trim()}%`;
      where.push('(s.customer_email LIKE ? OR s.stripe_subscription_id LIKE ? OR s.stripe_customer_id LIKE ? OR CAST(s.user_id AS CHAR) LIKE ?)');
      params.push(needle, needle, needle, needle);
    }

    return {
      whereSql: `WHERE ${where.join(' AND ')}`,
      params
    };
  }

  mapQueueRow(row) {
    const mapped = this.mapRow(row);
    if (!mapped) {
      return null;
    }

    return {
      ...mapped,
      productionStatus: String(row.production_status || mapped.productionStatus || 'to_prepare'),
      note: row.production_note == null ? (mapped.note || null) : String(row.production_note),
      displayName: null,
      profileMarket: row.profile_market ? String(row.profile_market).trim().toUpperCase() : mapped.profileMarket,
      paymentMethodLast4: null,
      paymentMethodBrand: null
    };
  }

  queueSelectSql() {
    return [
      'SELECT s.id, s.user_id, s.customer_email, s.stripe_subscription_id, s.stripe_customer_id,',
      's.stripe_account, s.status, s.plan_label, s.stripe_price_id, s.current_period_start, s.current_period_end,',
      's.cancel_at_period_end, s.pets_snapshot, s.plan_selection, s.shipping, s.address, s.subscription_term_months,',
      's.edit_payment_pending, s.edit_pending, s.created_at, s.updated_at,',
      "COALESCE(c.status, 'to_prepare') AS production_status, c.note AS production_note, pm.meta_value AS profile_market"
    ].join(' ');
  }

  async listQueue(input = {}) {
    this.ensureDataSource();
    const { whereSql, params } = this.queueMembership(input);
    const joinSql = this.queueJoinSql();

    try {
      const countRows = await this.dataSource.query(
        `SELECT COUNT(*) AS total ${joinSql} ${whereSql}`,
        params
      );
      const total = Number(Array.isArray(countRows) && countRows[0] ? countRows[0].total : 0);
      const rows = await this.dataSource.query(
        [
          this.queueSelectSql(),
          joinSql,
          whereSql,
          'ORDER BY s.current_period_end ASC, s.id ASC',
          'LIMIT ? OFFSET ?'
        ].join(' '),
        [...params, input.perPage, input.offset]
      );

      return {
        total,
        items: (Array.isArray(rows) ? rows : []).map((row) => this.mapQueueRow(row)).filter(Boolean)
      };
    } catch (error) {
      if (isMissingTableError(error)) {
        return { total: 0, items: [] };
      }
      throw error;
    }
  }

  async listQueueMetricRows(input = {}) {
    this.ensureDataSource();
    const { whereSql, params } = this.queueMembership({
      startOfToday: input.startOfToday,
      windowEndExclusive: input.windowEndExclusive,
      overdueFloor: input.overdueFloor,
      includeOverdue: input.includeOverdue,
      account: input.account,
      stripeAccounts: input.stripeAccounts
    });
    const joinSql = this.queueJoinSql();

    try {
      const rows = await this.dataSource.query(
        `SELECT s.current_period_end, COALESCE(c.status,'to_prepare') AS production_status ${joinSql} ${whereSql}`,
        params
      );
      return Array.isArray(rows) ? rows : [];
    } catch (error) {
      if (isMissingTableError(error)) {
        return [];
      }
      throw error;
    }
  }

  async findQueueRowById(id) {
    this.ensureDataSource();
    const numericId = Number(id);
    if (!Number.isSafeInteger(numericId) || numericId < 1) {
      return null;
    }

    try {
      const rows = await this.dataSource.query(
        [
          this.queueSelectSql(),
          this.queueJoinSql(),
          'WHERE s.id = ? LIMIT 1'
        ].join(' '),
        [numericId]
      );
      return this.mapQueueRow(Array.isArray(rows) ? rows[0] : null);
    } catch (error) {
      if (isMissingTableError(error)) {
        return null;
      }
      throw error;
    }
  }

  async findReferencedCatalogIds({ variationIds = [], priceIds = [] } = {}) {
    const variations = [...new Set(variationIds.map((id) => String(id).trim()).filter(Boolean))];
    const prices = [...new Set(priceIds.map((id) => String(id).trim()).filter((id) => id.startsWith('price_')))];
    if (!variations.length && !prices.length) {
      return { variationIds: [], priceIds: [] };
    }

    this.ensureDataSource();
    const where = [];
    const params = [];
    const inList = (column, values) => {
      where.push(`${column} IN (${values.map(() => '?').join(', ')})`);
      params.push(...values);
    };
    if (prices.length) {
      inList('s.stripe_price_id', prices);
      inList('jt.price_id', prices);
      inList('jt.alt_price', prices);
    }
    if (variations.length) {
      inList('jt.variation_id', variations);
    }

    try {
      const rows = await this.dataSource.query(
        [
          'SELECT s.stripe_price_id AS column_price, jt.price_id AS line_price, jt.alt_price AS alt_price, jt.variation_id AS line_variation',
          `FROM \`${this.tableName}\` s`,
          'LEFT JOIN JSON_TABLE(',
          'CASE WHEN JSON_VALID(s.plan_selection) THEN s.plan_selection ELSE JSON_OBJECT() END,',
          "'$.catalog_pricing.line_items[*]' COLUMNS (",
          "price_id VARCHAR(64) PATH '$.stripe_price_id',",
          "alt_price VARCHAR(64) PATH '$.price_id',",
          "variation_id VARCHAR(32) PATH '$.variation_id'",
          ')',
          ') jt ON TRUE',
          `WHERE ${where.join(' OR ')}`
        ].join(' '),
        params
      );
      const usedVariations = new Set();
      const usedPrices = new Set();
      const variationSet = new Set(variations);
      const priceSet = new Set(prices);
      for (const row of Array.isArray(rows) ? rows : []) {
        const variationId = row.line_variation == null ? '' : String(row.line_variation);
        if (variationSet.has(variationId)) {
          usedVariations.add(variationId);
        }
        for (const price of [row.column_price, row.line_price, row.alt_price]) {
          const id = price == null ? '' : String(price);
          if (priceSet.has(id)) {
            usedPrices.add(id);
          }
        }
      }
      return { variationIds: [...usedVariations], priceIds: [...usedPrices] };
    } catch (error) {
      if (isMissingTableError(error)) {
        return { variationIds: [], priceIds: [] };
      }
      throw error;
    }
  }
}

module.exports = {
  SubscriptionLedgerRepository
};
