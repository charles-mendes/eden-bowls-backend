const { HttpError } = require('../../core/http-error');
const { ADMIN_ROLES_META_KEY } = require('../../core/admin-roles');

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

  mapUserRow(row) {
    return {
      id: String(row.id),
      email: String(row.email || ''),
      status: String(row.status || '').trim().toLowerCase() || 'active',
      createdAt: row.createdAt || null,
      displayName: row.displayName ? String(row.displayName) : null,
      storedRoles: row.storedRoles == null ? '' : String(row.storedRoles),
      profile: {
        fullName: row.displayName ? String(row.displayName) : null,
        phone: row.phone ? String(row.phone) : null
      }
    };
  }

  async listUsers({ q, offset, perPage }) {
    this.ensureDataSource();
    const where = [];
    const params = [];

    if (q) {
      where.push('(LOWER(u.user_email) LIKE ? OR LOWER(u.display_name) LIKE ?)');
      const needle = `%${String(q).trim().toLowerCase()}%`;
      params.push(needle, needle);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const countRows = await this.dataSource.query(
      `SELECT COUNT(*) AS total FROM \`${this.tableNames.users}\` u ${whereSql}`,
      params
    );
    const total = Number(Array.isArray(countRows) && countRows[0] ? countRows[0].total : 0);
    const rows = await this.dataSource.query(
      [
        'SELECT u.ID AS id, u.user_email AS email, u.display_name AS displayName, u.created_at AS createdAt,',
        "MAX(CASE WHEN um.meta_key = 'hsr_activation_status' THEN um.meta_value END) AS status,",
        "MAX(CASE WHEN um.meta_key = 'billing_phone' THEN um.meta_value END) AS phone,",
        `MAX(CASE WHEN um.meta_key = '${ADMIN_ROLES_META_KEY}' THEN um.meta_value END) AS storedRoles`,
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
        'SELECT u.ID AS id, u.user_email AS email, u.display_name AS displayName, u.created_at AS createdAt,',
        "MAX(CASE WHEN um.meta_key = 'hsr_activation_status' THEN um.meta_value END) AS status,",
        "MAX(CASE WHEN um.meta_key = 'billing_phone' THEN um.meta_value END) AS phone,",
        `MAX(CASE WHEN um.meta_key = '${ADMIN_ROLES_META_KEY}' THEN um.meta_value END) AS storedRoles`,
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
        'SELECT u.ID AS id, u.user_email AS email, u.display_name AS displayName, u.created_at AS createdAt,',
        "MAX(CASE WHEN um.meta_key = 'hsr_activation_status' THEN um.meta_value END) AS status,",
        "MAX(CASE WHEN um.meta_key = 'billing_phone' THEN um.meta_value END) AS phone,",
        `MAX(CASE WHEN um.meta_key = '${ADMIN_ROLES_META_KEY}' THEN um.meta_value END) AS storedRoles`,
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

  async saveStoredRoles(userId, roles) {
    this.ensureDataSource();

    if (!Array.isArray(roles) || roles.length === 0) {
      await this.dataSource.query(
        `DELETE FROM \`${this.tableNames.usermeta}\` WHERE \`user_id\` = ? AND \`meta_key\` = ?`,
        [userId, ADMIN_ROLES_META_KEY]
      );
      return;
    }

    const existing = await this.dataSource.query(
      `SELECT \`umeta_id\` AS id FROM \`${this.tableNames.usermeta}\` WHERE \`user_id\` = ? AND \`meta_key\` = ? LIMIT 1`,
      [userId, ADMIN_ROLES_META_KEY]
    );
    const rowId = metaRowId(Array.isArray(existing) ? existing[0] : null);
    const metaValue = JSON.stringify(roles);

    if (rowId != null) {
      await this.dataSource.query(
        `UPDATE \`${this.tableNames.usermeta}\` SET \`meta_value\` = ? WHERE \`umeta_id\` = ?`,
        [metaValue, rowId]
      );
      return;
    }

    await this.dataSource.query(
      `INSERT INTO \`${this.tableNames.usermeta}\` (\`user_id\`, \`meta_key\`, \`meta_value\`) VALUES (?, ?, ?)`,
      [userId, ADMIN_ROLES_META_KEY, metaValue]
    );
  }

  async saveActivationStatus(userId, status) {
    this.ensureDataSource();
    const existing = await this.dataSource.query(
      `SELECT \`umeta_id\` AS id FROM \`${this.tableNames.usermeta}\` WHERE \`user_id\` = ? AND \`meta_key\` = 'hsr_activation_status' LIMIT 1`,
      [userId]
    );
    const row = Array.isArray(existing) ? existing[0] : null;
    const metaValue = String(status || '').trim().toLowerCase();

    if (row && row.id) {
      await this.dataSource.query(
        `UPDATE \`${this.tableNames.usermeta}\` SET \`meta_value\` = ? WHERE \`umeta_id\` = ?`,
        [metaValue, row.id]
      );
      return;
    }

    await this.dataSource.query(
      `INSERT INTO \`${this.tableNames.usermeta}\` (\`user_id\`, \`meta_key\`, \`meta_value\`) VALUES (?, 'hsr_activation_status', ?)`,
      [userId, metaValue]
    );
  }
}

module.exports = {
  AdminUsersRepository
};
