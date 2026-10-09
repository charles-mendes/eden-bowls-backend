const { HttpError } = require('../../core/http-error');
const { PROFILE_MARKET_META_KEY } = require('../../core/admin-market-scope');

const DEFAULT_TABLES = {
  users: 'wp_users',
  usermeta: 'wp_usermeta',
  subscriptions: 'stripe_subscriptions'
};

// One row per customer and Stripe account whose profile market points to the other account.
// Shared by the admin conflicts route and the backfill dry-run so both report the same total.
function conflictPairsSql(tables = DEFAULT_TABLES) {
  return [
    'SELECT DISTINCT sub.`user_id` AS user_id,',
    'LOWER(TRIM(sub.`stripe_account`)) AS stripe_account,',
    'UPPER(TRIM(pm.`meta_value`)) AS profile_market',
    `FROM \`${tables.subscriptions}\` sub`,
    `INNER JOIN \`${tables.usermeta}\` pm ON pm.\`user_id\` = sub.\`user_id\` AND pm.\`meta_key\` = ?`,
    "WHERE UPPER(TRIM(pm.`meta_value`)) IN ('BR', 'US')",
    "AND LOWER(TRIM(sub.`stripe_account`)) IN ('br', 'us')",
    'AND LOWER(TRIM(sub.`stripe_account`)) <> LOWER(TRIM(pm.`meta_value`))'
  ].join(' ');
}

async function countMarketConflicts(query, tables = DEFAULT_TABLES) {
  const rows = await query(
    `SELECT COUNT(*) AS total FROM (${conflictPairsSql(tables)}) conflicts`,
    [PROFILE_MARKET_META_KEY]
  );
  return Number(rows && rows[0] && rows[0].total || 0);
}

class MarketConflictsRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tables = {
      users: options.usersTableName || DEFAULT_TABLES.users,
      usermeta: options.usermetaTableName || DEFAULT_TABLES.usermeta,
      subscriptions: options.subscriptionsTableName || DEFAULT_TABLES.subscriptions
    };
  }

  ensureDataSource() {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }
  }

  query(sql, params) {
    return this.dataSource.query(sql, params);
  }

  async count() {
    this.ensureDataSource();
    return countMarketConflicts((sql, params) => this.query(sql, params), this.tables);
  }

  async list({ offset = 0, perPage = 20 } = {}) {
    this.ensureDataSource();
    const total = await this.count();
    const rows = await this.query(
      [
        'SELECT conflicts.user_id AS userId, u.`user_email` AS email,',
        'conflicts.profile_market AS profileMarket, conflicts.stripe_account AS stripeAccount',
        `FROM (${conflictPairsSql(this.tables)}) conflicts`,
        `LEFT JOIN \`${this.tables.users}\` u ON u.\`ID\` = conflicts.user_id`,
        'ORDER BY u.`user_email` ASC, conflicts.stripe_account ASC, conflicts.user_id ASC',
        'LIMIT ? OFFSET ?'
      ].join(' '),
      [PROFILE_MARKET_META_KEY, Number(perPage), Number(offset)]
    );

    return {
      total,
      items: (Array.isArray(rows) ? rows : []).map((row) => ({
        userId: String(row.userId),
        email: row.email == null ? '' : String(row.email),
        profileMarket: String(row.profileMarket || '').toUpperCase(),
        stripeAccount: String(row.stripeAccount || '').toLowerCase()
      }))
    };
  }
}

module.exports = {
  MarketConflictsRepository,
  conflictPairsSql,
  countMarketConflicts
};
