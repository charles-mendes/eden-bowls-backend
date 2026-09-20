const { HttpError } = require('../../core/http-error');
const { ADMIN_ROLES_META_KEY } = require('../../core/admin-roles');
const {
  ADMIN_MARKETS_META_KEY,
  PROFILE_MARKET_META_KEY,
  appendCustomerMarketFilter
} = require('../../core/admin-market-scope');
const { INVITE_META_KEYS } = require('../../core/staff-invite');

function metaRowId(row) {
  if (!row || typeof row !== 'object') {
    return null;
  }

  const value = row.id ?? row.ID ?? row.umeta_id ?? row.umetaId;
  if (value == null || value === '') {
    return null;
  }

  return value;
}

function readInsertId(result) {
  if (result && typeof result.insertId !== 'undefined') {
    return Number(result.insertId);
  }

  if (Array.isArray(result) && result[0] && typeof result[0].insertId !== 'undefined') {
    return Number(result[0].insertId);
  }

  return 0;
}

function isDuplicateEntry(error) {
  return Number(error && error.errno) === 1062 || String(error && error.code || '') === 'ER_DUP_ENTRY';
}

class AdminUsersRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tableNames = {
      users: options.usersTableName || 'wp_users',
      usermeta: options.usermetaTableName || 'wp_usermeta'
    };
  }

  ensureDataSource() {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }
  }

  userSelectSql() {
    return [
      'SELECT u.ID AS id, u.user_email AS email, u.display_name AS displayName, u.created_at AS createdAt,',
      "MAX(CASE WHEN um.meta_key = 'hsr_activation_status' THEN um.meta_value END) AS status,",
      "MAX(CASE WHEN um.meta_key = 'billing_phone' THEN um.meta_value END) AS phone,",
      `MAX(CASE WHEN um.meta_key = '${ADMIN_ROLES_META_KEY}' THEN um.meta_value END) AS storedRoles,`,
      `MAX(CASE WHEN um.meta_key = '${ADMIN_MARKETS_META_KEY}' THEN um.meta_value END) AS storedMarkets,`,
      `MAX(CASE WHEN um.meta_key = '${PROFILE_MARKET_META_KEY}' THEN um.meta_value END) AS profileMarket,`,
      `MAX(CASE WHEN um.meta_key = '${INVITE_META_KEYS.mailStatus}' THEN um.meta_value END) AS inviteMailStatus,`,
      `MAX(CASE WHEN um.meta_key = '${INVITE_META_KEYS.expiresAt}' THEN um.meta_value END) AS inviteExpiresAt,`,
      `MAX(CASE WHEN um.meta_key = '${INVITE_META_KEYS.mustChangePassword}' THEN um.meta_value END) AS mustChangePassword,`,
      `MAX(CASE WHEN um.meta_key = '${INVITE_META_KEYS.resendCount}' THEN um.meta_value END) AS inviteResendCount,`,
      `MAX(CASE WHEN um.meta_key = '${INVITE_META_KEYS.resendWindowStart}' THEN um.meta_value END) AS inviteResendWindowStart,`,
      `MAX(CASE WHEN um.meta_key = '${INVITE_META_KEYS.deletedAt}' THEN um.meta_value END) AS deletedAt`
    ].join(' ');
  }

  mapUserRow(row) {
    return {
      id: String(row.id),
      email: String(row.email || ''),
      status: String(row.status || '').trim().toLowerCase() || 'active',
      createdAt: row.createdAt || null,
      displayName: row.displayName ? String(row.displayName) : null,
      storedRoles: row.storedRoles == null ? '' : String(row.storedRoles),
      storedMarkets: row.storedMarkets == null ? '' : String(row.storedMarkets),
      profileMarket: row.profileMarket == null ? '' : String(row.profileMarket).trim().toUpperCase(),
      inviteMailStatus: row.inviteMailStatus ? String(row.inviteMailStatus) : null,
      inviteExpiresAt: row.inviteExpiresAt ? String(row.inviteExpiresAt) : null,
      mustChangePassword: String(row.mustChangePassword || ''),
      inviteResendCount: String(row.inviteResendCount || ''),
      inviteResendWindowStart: String(row.inviteResendWindowStart || ''),
      deletedAt: row.deletedAt ? String(row.deletedAt) : null,
      profile: {
        fullName: row.displayName ? String(row.displayName) : null,
        phone: row.phone ? String(row.phone) : null
      }
    };
  }

  deletedExcludeSql() {
    return [
      `AND NOT EXISTS (SELECT 1 FROM \`${this.tableNames.usermeta}\` d`,
      'WHERE d.user_id = u.ID',
      `AND d.meta_key = '${INVITE_META_KEYS.deletedAt}'`,
      "AND d.meta_value IS NOT NULL AND TRIM(d.meta_value) != '')"
    ].join(' ');
  }

  async listUsers({ q, offset, perPage, includeDeleted = false, identity = null, markets = [], filtered = false }) {
    this.ensureDataSource();
    const where = [];
    const params = [];

    if (q) {
      where.push('(LOWER(u.user_email) LIKE ? OR LOWER(u.display_name) LIKE ?)');
      const needle = `%${String(q).trim().toLowerCase()}%`;
      params.push(needle, needle);
    }

    appendCustomerMarketFilter(where, params, {
      identity,
      markets,
      filtered,
      usermetaTable: this.tableNames.usermeta,
      userIdExpr: 'u.ID'
    });

    const deletedSql = includeDeleted ? '' : this.deletedExcludeSql();
    const whereSql = where.length ? `WHERE ${where.join(' AND ')} ${deletedSql}` : (deletedSql ? `WHERE 1=1 ${deletedSql}` : '');
    const countRows = await this.dataSource.query(
      `SELECT COUNT(*) AS total FROM \`${this.tableNames.users}\` u ${whereSql}`,
      params
    );
    const total = Number(Array.isArray(countRows) && countRows[0] ? countRows[0].total : 0);
    const rows = await this.dataSource.query(
      [
        this.userSelectSql(),
        `FROM \`${this.tableNames.users}\` u`,
        `LEFT JOIN \`${this.tableNames.usermeta}\` um ON um.user_id = u.ID`,
        whereSql,
        'GROUP BY u.ID, u.user_email, u.display_name, u.created_at',
        'ORDER BY u.created_at DESC',
        'LIMIT ? OFFSET ?'
      ].join(' '),
      [...params, perPage, offset]
    );

    return {
      total,
      items: (Array.isArray(rows) ? rows : []).map((row) => this.mapUserRow(row))
    };
  }

  async listStaff({ q, offset, perPage, adminEmails = [] }) {
    this.ensureDataSource();
    const where = [];
    const params = [];
    const staffClause = [
      `EXISTS (SELECT 1 FROM \`${this.tableNames.usermeta}\` m WHERE m.user_id = u.ID AND m.meta_key = ? AND m.meta_value IS NOT NULL AND TRIM(m.meta_value) != '' AND TRIM(m.meta_value) != '[]' AND TRIM(m.meta_value) != '["customer"]')`
    ];
    params.push(ADMIN_ROLES_META_KEY);

    if (adminEmails.length) {
      staffClause.push(`LOWER(u.user_email) IN (${adminEmails.map(() => '?').join(', ')})`);
      params.push(...adminEmails);
    }

    where.push(`(${staffClause.join(' OR ')})`);
    where.push(`1=1 ${this.deletedExcludeSql()}`);

    if (q) {
      where.push('(LOWER(u.user_email) LIKE ? OR LOWER(u.display_name) LIKE ?)');
      const needle = `%${String(q).trim().toLowerCase()}%`;
      params.push(needle, needle);
    }

    const whereSql = `WHERE ${where.join(' AND ')}`;
    const countRows = await this.dataSource.query(
      `SELECT COUNT(*) AS total FROM \`${this.tableNames.users}\` u ${whereSql}`,
      params
    );
    const total = Number(Array.isArray(countRows) && countRows[0] ? countRows[0].total : 0);
    const rows = await this.dataSource.query(
      [
        this.userSelectSql(),
        `FROM \`${this.tableNames.users}\` u`,
        `LEFT JOIN \`${this.tableNames.usermeta}\` um ON um.user_id = u.ID`,
        whereSql,
        'GROUP BY u.ID, u.user_email, u.display_name, u.created_at',
        'ORDER BY u.user_email ASC',
        'LIMIT ? OFFSET ?'
      ].join(' '),
      [...params, perPage, offset]
    );

    return {
      total,
      items: (Array.isArray(rows) ? rows : []).map((row) => this.mapUserRow(row))
    };
  }

  async findUserById(userId) {
    this.ensureDataSource();
    const rows = await this.dataSource.query(
      [
        this.userSelectSql(),
        `FROM \`${this.tableNames.users}\` u`,
        `LEFT JOIN \`${this.tableNames.usermeta}\` um ON um.user_id = u.ID`,
        'WHERE u.ID = ?',
        'GROUP BY u.ID, u.user_email, u.display_name, u.created_at',
        'LIMIT 1'
      ].join(' '),
      [userId]
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    return row ? this.mapUserRow(row) : null;
  }

  async findUserIdByEmail(email) {
    this.ensureDataSource();
    const normalized = String(email || '').trim().toLowerCase();
    const rows = await this.dataSource.query(
      `SELECT \`ID\` AS id FROM \`${this.tableNames.users}\` WHERE LOWER(\`user_email\`) = ? LIMIT 1`,
      [normalized]
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    const userId = Number(row && row.id);
    return Number.isSafeInteger(userId) && userId > 0 ? String(userId) : null;
  }

  async createUser({ userLogin, userPass, userNicename, userEmail, displayName }) {
    this.ensureDataSource();

    try {
      const result = await this.dataSource.query(
        [
          `INSERT INTO \`${this.tableNames.users}\``,
          '(`user_login`, `user_pass`, `user_nicename`, `user_email`, `display_name`)',
          'VALUES (?, ?, ?, ?, ?)'
        ].join(' '),
        [userLogin, userPass, userNicename, userEmail, displayName]
      );
      const userId = readInsertId(result);
      if (!Number.isSafeInteger(userId) || userId < 1) {
        throw new HttpError(503, 'Unable to create account.');
      }

      return { id: String(userId), email: userEmail };
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }

      if (isDuplicateEntry(error)) {
        throw new HttpError(409, 'This e-mail is already registered.', {
          code: 'account_email_exists',
          field: 'email'
        });
      }

      throw error;
    }
  }

  async updateDisplayName(userId, displayName) {
    this.ensureDataSource();
    await this.dataSource.query(
      `UPDATE \`${this.tableNames.users}\` SET \`display_name\` = ? WHERE \`ID\` = ?`,
      [displayName, userId]
    );
  }

  async updatePassword(userId, passwordHash) {
    this.ensureDataSource();
    await this.dataSource.query(
      `UPDATE \`${this.tableNames.users}\` SET \`user_pass\` = ? WHERE \`ID\` = ?`,
      [passwordHash, userId]
    );
  }

  async getUserPass(userId) {
    this.ensureDataSource();
    const rows = await this.dataSource.query(
      `SELECT \`user_pass\` AS userPass FROM \`${this.tableNames.users}\` WHERE \`ID\` = ? LIMIT 1`,
      [userId]
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    return row && row.userPass != null ? String(row.userPass) : '';
  }

  async upsertUserMeta(userId, metaKey, metaValue) {
    this.ensureDataSource();
    const existing = await this.dataSource.query(
      `SELECT \`umeta_id\` AS id FROM \`${this.tableNames.usermeta}\` WHERE \`user_id\` = ? AND \`meta_key\` = ? LIMIT 1`,
      [userId, metaKey]
    );
    const rowId = metaRowId(Array.isArray(existing) ? existing[0] : null);

    if (rowId != null) {
      await this.dataSource.query(
        `UPDATE \`${this.tableNames.usermeta}\` SET \`meta_value\` = ? WHERE \`umeta_id\` = ?`,
        [metaValue, rowId]
      );
      return;
    }

    await this.dataSource.query(
      `INSERT INTO \`${this.tableNames.usermeta}\` (\`user_id\`, \`meta_key\`, \`meta_value\`) VALUES (?, ?, ?)`,
      [userId, metaKey, metaValue]
    );
  }

  async deleteUserMeta(userId, metaKey) {
    this.ensureDataSource();
    await this.dataSource.query(
      `DELETE FROM \`${this.tableNames.usermeta}\` WHERE \`user_id\` = ? AND \`meta_key\` = ?`,
      [userId, metaKey]
    );
  }

  async saveStoredRoles(userId, roles) {
    this.ensureDataSource();

    if (!Array.isArray(roles) || roles.length === 0) {
      await this.deleteUserMeta(userId, ADMIN_ROLES_META_KEY);
      return;
    }

    await this.upsertUserMeta(userId, ADMIN_ROLES_META_KEY, JSON.stringify(roles));
  }

  async saveStoredMarkets(userId, markets) {
    this.ensureDataSource();

    if (!Array.isArray(markets) || markets.length === 0) {
      await this.deleteUserMeta(userId, ADMIN_MARKETS_META_KEY);
      return;
    }

    await this.upsertUserMeta(userId, ADMIN_MARKETS_META_KEY, JSON.stringify(markets));
  }

  async saveActivationStatus(userId, status) {
    await this.upsertUserMeta(userId, 'hsr_activation_status', String(status || '').trim().toLowerCase());
  }
}

module.exports = {
  AdminUsersRepository
};
