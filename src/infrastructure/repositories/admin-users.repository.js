const { HttpError } = require('../../core/http-error');

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
        'SELECT u.ID AS id, u.user_email AS email, u.display_name AS displayName, u.user_registered AS createdAt,',
        "MAX(CASE WHEN um.meta_key = 'hsr_activation_status' THEN um.meta_value END) AS status,",
        "MAX(CASE WHEN um.meta_key = 'billing_phone' THEN um.meta_value END) AS phone",
        `FROM \`${this.tableNames.users}\` u`,
        `LEFT JOIN \`${this.tableNames.usermeta}\` um ON um.user_id = u.ID`,
        whereSql,
        'GROUP BY u.ID, u.user_email, u.display_name, u.user_registered',
        'ORDER BY u.user_registered DESC',
        'LIMIT ? OFFSET ?'
      ].join(' '),
      [...params, perPage, offset]
    );

    return {
      total,
      items: (Array.isArray(rows) ? rows : []).map((row) => ({
        id: String(row.id),
        email: String(row.email || ''),
        status: String(row.status || '').trim().toLowerCase() || 'active',
        createdAt: row.createdAt,
        profile: {
          fullName: row.displayName ? String(row.displayName) : null,
          phone: row.phone ? String(row.phone) : null
        }
      }))
    };
  }
}

module.exports = {
  AdminUsersRepository
};
