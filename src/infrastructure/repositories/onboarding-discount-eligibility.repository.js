const { HttpError } = require('../../core/http-error');

const PREVIOUS_PURCHASE_STATUSES = [
  'wc-pending',
  'pending',
  'wc-on-hold',
  'on-hold',
  'wc-processing',
  'processing',
  'wc-completed',
  'completed'
];

function parseJsonColumn(value) {
  if (!value) {
    return null;
  }

  if (typeof value === 'object') {
    return value;
  }

  try {
    return JSON.parse(String(value));
  } catch (_error) {
    return null;
  }
}

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

class OnboardingDiscountEligibilityRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tableNames = {
      posts: options.postsTableName || 'wp_posts',
      postmeta: options.postmetaTableName || 'wp_postmeta',
      users: options.usersTableName || 'wp_users',
      subscriptions: options.subscriptionsTableName || 'wp_hsr_stripe_subscriptions',
      nodeSubscriptions: options.nodeSubscriptionsTableName || 'stripe_subscriptions',
      userState: options.userStateTableName || 'onboarding_user_state'
    };
  }

  ensureDataSource() {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }
  }

  async getEligibility(userId) {
    if (!userId) {
      return {
        validated: false,
        eligible: null,
        reason: 'NOT_AUTHENTICATED'
      };
    }

    this.ensureDataSource();

    const excludeOrderId = await this.getCurrentCheckoutOrderId(userId);
    if (await this.hasPreviousPurchase(userId, excludeOrderId)) {
      return {
        validated: true,
        eligible: false,
        reason: 'HAS_PREVIOUS_PURCHASE'
      };
    }

    const email = await this.getUserEmail(userId);
    if (await this.hasActiveSubscription(userId, email)) {
      return {
        validated: true,
        eligible: false,
        reason: 'HAS_ACTIVE_SUBSCRIPTION'
      };
    }

    return {
      validated: true,
      eligible: true,
      reason: null
    };
  }

  async getCurrentCheckoutOrderId(userId) {
    try {
      const rows = await this.dataSource.query(
        `SELECT \`checkout_reference\` FROM \`${this.tableNames.userState}\` WHERE \`user_id\` = ? LIMIT 1`,
        [userId]
      );
      const row = Array.isArray(rows) ? rows[0] : null;
      const reference = parseJsonColumn(row && row.checkout_reference);
      const orderId = Number(reference && reference.order_id);

      return Number.isSafeInteger(orderId) && orderId > 0 ? orderId : null;
    } catch (error) {
      if (isMissingTableError(error)) {
        return null;
      }

      throw error;
    }
  }

  async hasPreviousPurchase(userId, excludeOrderId) {
    const params = [...PREVIOUS_PURCHASE_STATUSES, String(userId)];
    let excludeSql = '';

    if (Number.isSafeInteger(Number(excludeOrderId)) && Number(excludeOrderId) > 0) {
      excludeSql = 'AND p.ID <> ?';
      params.push(Number(excludeOrderId));
    }

    const sql = [
      'SELECT p.ID AS id',
      `FROM \`${this.tableNames.posts}\` p`,
      `INNER JOIN \`${this.tableNames.postmeta}\` pm ON pm.post_id = p.ID AND pm.meta_key = '_customer_user'`,
      "WHERE p.post_type IN ('shop_order', 'shop_order_placehold')",
      `AND p.post_status IN (${PREVIOUS_PURCHASE_STATUSES.map(() => '?').join(', ')})`,
      'AND pm.meta_value = ?',
      excludeSql,
      'LIMIT 1'
    ].filter(Boolean).join(' ');

    const rows = await this.dataSource.query(sql, params);
    return Array.isArray(rows) && rows.length > 0;
  }

  async getUserEmail(userId) {
    const rows = await this.dataSource.query(
      `SELECT \`user_email\` FROM \`${this.tableNames.users}\` WHERE \`ID\` = ? LIMIT 1`,
      [userId]
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    const email = String(row && row.user_email || '').trim();
    return email || null;
  }

  async hasActiveSubscription(userId, email) {
    const nodeResult = await this.queryActiveSubscription(
      this.tableNames.nodeSubscriptions,
      'user_id',
      userId,
      email
    );
    if (nodeResult === true) {
      return true;
    }

    const wpResult = await this.queryActiveSubscription(
      this.tableNames.subscriptions,
      'wp_user_id',
      userId,
      email
    );
    return wpResult === true;
  }

  async queryActiveSubscription(tableName, userColumn, userId, email) {
    try {
      const byUser = await this.dataSource.query(
        `SELECT 1 AS ok FROM \`${tableName}\` WHERE \`${userColumn}\` = ? AND status IN ('active', 'trialing') LIMIT 1`,
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
        `SELECT 1 AS ok FROM \`${tableName}\` WHERE customer_email = ? AND status IN ('active', 'trialing') LIMIT 1`,
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
}

module.exports = {
  OnboardingDiscountEligibilityRepository,
  PREVIOUS_PURCHASE_STATUSES
};
