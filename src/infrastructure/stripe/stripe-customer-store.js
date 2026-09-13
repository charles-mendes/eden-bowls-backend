const { HttpError } = require('../../core/http-error');
const {
  LEGACY_CUSTOMER_META_KEY,
  customerMetaKey,
  normalizeStripeAccount,
  STRIPE_ACCOUNTS
} = require('../../core/stripe-account');

class StripeCustomerStore {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.usermetaTableName = options.usermetaTableName || 'wp_usermeta';
  }

  ensureDataSource() {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }
  }

  requireAccount(account) {
    return normalizeStripeAccount(account);
  }

  async getCustomerId(userId, account) {
    this.ensureDataSource();
    const stripeAccount = this.requireAccount(account);
    const metaKey = customerMetaKey(stripeAccount);
    const rows = await this.dataSource.query(
      `SELECT \`meta_value\` FROM \`${this.usermetaTableName}\` WHERE \`user_id\` = ? AND \`meta_key\` = ? LIMIT 1`,
      [userId, metaKey]
    );
    const value = Array.isArray(rows) && rows[0] ? String(rows[0].meta_value || '').trim() : '';
    if (value.startsWith('cus_')) {
      return value;
    }

    if (stripeAccount === STRIPE_ACCOUNTS.US) {
      const legacy = await this.dataSource.query(
        `SELECT \`meta_value\` FROM \`${this.usermetaTableName}\` WHERE \`user_id\` = ? AND \`meta_key\` = ? LIMIT 1`,
        [userId, LEGACY_CUSTOMER_META_KEY]
      );
      const legacyValue = Array.isArray(legacy) && legacy[0] ? String(legacy[0].meta_value || '').trim() : '';
      return legacyValue.startsWith('cus_') ? legacyValue : '';
    }

    return '';
  }

  async saveCustomerId(userId, customerId, account) {
    this.ensureDataSource();
    const stripeAccount = this.requireAccount(account);
    const value = String(customerId || '').trim();
    if (!value.startsWith('cus_')) {
      return;
    }

    const metaKey = customerMetaKey(stripeAccount);
    const existing = await this.dataSource.query(
      `SELECT \`umeta_id\` AS id FROM \`${this.usermetaTableName}\` WHERE \`user_id\` = ? AND \`meta_key\` = ? LIMIT 1`,
      [userId, metaKey]
    );
    const row = Array.isArray(existing) ? existing[0] : null;

    if (row && row.id) {
      await this.dataSource.query(
        `UPDATE \`${this.usermetaTableName}\` SET \`meta_value\` = ? WHERE \`umeta_id\` = ?`,
        [value, row.id]
      );
      return;
    }

    await this.dataSource.query(
      `INSERT INTO \`${this.usermetaTableName}\` (\`user_id\`, \`meta_key\`, \`meta_value\`) VALUES (?, ?, ?)`,
      [userId, metaKey, value]
    );
  }

  async findUserIdByCustomerId(customerId) {
    this.ensureDataSource();
    const value = String(customerId || '').trim();
    if (!value.startsWith('cus_')) {
      return null;
    }

    const rows = await this.dataSource.query(
      `SELECT \`user_id\` FROM \`${this.usermetaTableName}\` WHERE \`meta_value\` = ? AND \`meta_key\` IN (?, ?, ?) LIMIT 1`,
      [value, customerMetaKey('us'), customerMetaKey('br'), LEGACY_CUSTOMER_META_KEY]
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    const userId = Number(row && row.user_id);
    return Number.isSafeInteger(userId) && userId > 0 ? userId : null;
  }
}

module.exports = {
  StripeCustomerStore,
  STRIPE_CUSTOMER_META_KEY: LEGACY_CUSTOMER_META_KEY
};
