const { HttpError } = require('../../core/http-error');

class AuthRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tableNames = {
      users: options.usersTableName || 'wp_users',
      usermeta: options.usermetaTableName || 'wp_usermeta'
    };
  }

  async findUserForAuthentication(username) {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }

    const normalized = String(username || '').trim();
    const sql = [
      'SELECT u.ID AS id, u.user_login, u.user_pass, u.user_email, u.user_nicename, u.display_name,',
      "MAX(CASE WHEN um.meta_key = 'hsr_activation_status' THEN um.meta_value END) AS activation_status",
      `FROM \`${this.tableNames.users}\` u`,
      `LEFT JOIN \`${this.tableNames.usermeta}\` um ON um.user_id = u.ID`,
      'WHERE u.user_login = ? OR u.user_email = ?',
      'GROUP BY u.ID, u.user_login, u.user_pass, u.user_email, u.user_nicename, u.display_name',
      'LIMIT 1'
    ].join(' ');

    const rows = await this.dataSource.query(sql, [normalized, normalized]);

    if (!Array.isArray(rows) || rows.length === 0) {
      return null;
    }

    const user = rows[0];

    return {
      id: Number(user.id),
      user_login: String(user.user_login || ''),
      user_pass: String(user.user_pass || ''),
      user_email: String(user.user_email || ''),
      user_nicename: String(user.user_nicename || ''),
      display_name: String(user.display_name || ''),
      activation_status: String(user.activation_status || '').trim().toLowerCase()
    };
  }
}

module.exports = {
  AuthRepository
};
