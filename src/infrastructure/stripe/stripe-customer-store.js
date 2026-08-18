const { HttpError } = require('../../core/http-error');

const STRIPE_CUSTOMER_META_KEY = '_hsr_stripe_customer_id';

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

  async getCustomerId(userId) {
    this.ensureDataSource();
    const rows = await this.dataSource.query(
      `SELECT \`meta_value\` FROM \`${this.usermetaTableName}\` WHERE \`user_id\` = ? AND \`meta_key\` = ? LIMIT 1`,
      [userId, STRIPE_CUSTOMER_META_KEY]
    );
    const value = Array.isArray(rows) && rows[0] ? String(rows[0].meta_value || '').trim() : '';
    return value.startsWith('cus_') ? value : '';
  }

  async saveCustomerId(userId, customerId) {
    this.ensureDataSource();
    const value = String(customerId || '').trim();
    if (!value.startsWith('cus_')) {
      return;
    }

    const existing = await this.dataSource.query(
      `SELECT \`umeta_id\` AS id FROM \`${this.usermetaTableName}\` WHERE \`user_id\` = ? AND \`meta_key\` = ? LIMIT 1`,
      [userId, STRIPE_CUSTOMER_META_KEY]
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
      [userId, STRIPE_CUSTOMER_META_KEY, value]
    );
  }

  async findUserIdByCustomerId(customerId) {
    this.ensureDataSource();
    const value = String(customerId || '').trim();
    if (!value.startsWith('cus_')) {
      return null;
    }

    const rows = await this.dataSource.query(
      `SELECT \`user_id\` FROM \`${this.usermetaTableName}\` WHERE \`meta_key\` = ? AND \`meta_value\` = ? LIMIT 1`,
      [STRIPE_CUSTOMER_META_KEY, value]
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    const userId = Number(row && row.user_id);
    return Number.isSafeInteger(userId) && userId > 0 ? userId : null;
  }
}

module.exports = {
  StripeCustomerStore,
  STRIPE_CUSTOMER_META_KEY
};
