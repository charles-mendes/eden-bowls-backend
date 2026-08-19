const { HttpError } = require('../../core/http-error');
const { parseJsonColumn } = require('../../core/stripe-subscription-map');

function isDuplicateEntry(error) {
  return Number(error && error.errno) === 1062 || String(error && error.code || '') === 'ER_DUP_ENTRY';
}

function getAffectedRows(result) {
  if (result && typeof result.affectedRows === 'number') {
    return result.affectedRows;
  }

  if (Array.isArray(result) && result[0] && typeof result[0].affectedRows === 'number') {
    return result[0].affectedRows;
  }

  return 0;
}

class ProfileRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tableNames = {
      users: options.usersTableName || 'wp_users',
      usermeta: options.usermetaTableName || 'wp_usermeta',
      userState: options.userStateTableName || 'onboarding_user_state',
      pets: options.petsTableName || 'onboarding_pets'
    };
  }

  ensureDataSource() {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }
  }

  async findUserById(userId) {
    this.ensureDataSource();

    const normalizedUserId = Number(userId);
    if (!Number.isSafeInteger(normalizedUserId) || normalizedUserId < 1) {
      return null;
    }

    const sql = [
      'SELECT u.ID AS id, u.user_login, u.user_email, u.display_name, u.user_pass,',
      "MAX(CASE WHEN um.meta_key = 'billing_phone' THEN um.meta_value END) AS billing_phone,",
      "MAX(CASE WHEN um.meta_key = '_eden_phone_country' THEN um.meta_value END) AS phone_country,",
      "MAX(CASE WHEN um.meta_key = '_eden_avatar_url' THEN um.meta_value END) AS avatar_url,",
      "MAX(CASE WHEN um.meta_key = '_eden_pwd_updated_at' THEN um.meta_value END) AS pwd_updated_at,",
      "MAX(CASE WHEN um.meta_key = 'hsr_market_country' THEN um.meta_value END) AS market_country,",
      "MAX(CASE WHEN um.meta_key = 'hsr_activation_status' THEN um.meta_value END) AS activation_status",
      `FROM \`${this.tableNames.users}\` u`,
      `LEFT JOIN \`${this.tableNames.usermeta}\` um ON um.user_id = u.ID`,
      'WHERE u.ID = ?',
      'GROUP BY u.ID, u.user_login, u.user_email, u.display_name, u.user_pass',
      'LIMIT 1'
    ].join(' ');
    const rows = await this.dataSource.query(sql, [normalizedUserId]);
    const user = Array.isArray(rows) ? rows[0] : null;

    if (!user) {
      return null;
    }

    return {
      id: Number(user.id),
      userLogin: String(user.user_login || ''),
      email: String(user.user_email || ''),
      displayName: String(user.display_name || ''),
      userPass: String(user.user_pass || ''),
      phone: user.billing_phone == null ? '' : String(user.billing_phone),
      phoneCountry: String(user.phone_country || '').trim(),
      avatarUrl: user.avatar_url == null ? '' : String(user.avatar_url),
      passwordLastUpdatedAt: user.pwd_updated_at == null ? null : String(user.pwd_updated_at),
      marketCountry: String(user.market_country || '').trim(),
      activationStatus: String(user.activation_status || '').trim().toLowerCase()
    };
  }

  async getAddress(userId) {
    this.ensureDataSource();
    const rows = await this.dataSource.query(
      `SELECT \`address\` FROM \`${this.tableNames.userState}\` WHERE \`user_id\` = ? LIMIT 1`,
      [userId]
    );
    const row = Array.isArray(rows) ? rows[0] : null;

    if (!row) {
      return { exists: false, address: null };
    }

    return {
      exists: true,
      address: parseJsonColumn(row.address) || {}
    };
  }

  async mergeAddress(userId, patch = {}, options = {}) {
    this.ensureDataSource();
    const current = await this.getAddress(userId);

    if (!current.exists && !options.createIfMissing) {
      return null;
    }

    const next = {
      ...(current.address || {}),
      ...patch
    };

    await this.dataSource.query(
      `INSERT INTO \`${this.tableNames.userState}\` (\`user_id\`, \`address\`) VALUES (?, ?) ON DUPLICATE KEY UPDATE \`address\` = VALUES(\`address\`)`,
      [userId, JSON.stringify(next)]
    );

    return next;
  }

  async updateDisplayName(userId, fullName) {
    this.ensureDataSource();
    await this.dataSource.query(
      `UPDATE \`${this.tableNames.users}\` SET \`display_name\` = ? WHERE \`ID\` = ?`,
      [fullName, userId]
    );
  }

  async updateUserEmail(userId, email) {
    this.ensureDataSource();

    try {
      const result = await this.dataSource.query(
        `UPDATE \`${this.tableNames.users}\` SET \`user_email\` = ? WHERE \`ID\` = ?`,
        [email, userId]
      );

      if (getAffectedRows(result) < 1) {
        throw new HttpError(500, 'Unable to update email.', { code: 'update_failed' });
      }
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }

      if (isDuplicateEntry(error)) {
        throw new HttpError(422, 'This email address is already in use.', {
          code: 'email_taken',
          field: 'newEmail'
        });
      }

      throw error;
    }
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
    return Number.isSafeInteger(userId) && userId > 0 ? userId : null;
  }

  async updateUserPassword(userId, passwordHash) {
    this.ensureDataSource();
    const result = await this.dataSource.query(
      `UPDATE \`${this.tableNames.users}\` SET \`user_pass\` = ? WHERE \`ID\` = ?`,
      [passwordHash, userId]
    );

    if (getAffectedRows(result) < 1) {
      throw new HttpError(500, 'Unable to update password.', { code: 'update_failed' });
    }
  }

  async upsertUserMeta(userId, metaKey, metaValue) {
    this.ensureDataSource();
    const existing = await this.dataSource.query(
      `SELECT \`umeta_id\` AS id FROM \`${this.tableNames.usermeta}\` WHERE \`user_id\` = ? AND \`meta_key\` = ? LIMIT 1`,
      [userId, metaKey]
    );
    const row = Array.isArray(existing) ? existing[0] : null;

    if (row && row.id) {
      await this.dataSource.query(
        `UPDATE \`${this.tableNames.usermeta}\` SET \`meta_value\` = ? WHERE \`umeta_id\` = ?`,
        [metaValue, row.id]
      );
      return;
    }

    await this.dataSource.query(
      `INSERT INTO \`${this.tableNames.usermeta}\` (\`user_id\`, \`meta_key\`, \`meta_value\`) VALUES (?, ?, ?)`,
      [userId, metaKey, metaValue]
    );
  }

  async getUserMeta(userId, metaKey) {
    this.ensureDataSource();
    const rows = await this.dataSource.query(
      `SELECT \`meta_value\` FROM \`${this.tableNames.usermeta}\` WHERE \`user_id\` = ? AND \`meta_key\` = ? LIMIT 1`,
      [userId, metaKey]
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    return row && row.meta_value != null ? String(row.meta_value) : '';
  }

  async softDeletePetsByUserId(userId, deletedAt) {
    this.ensureDataSource();
    await this.dataSource.query(
      `UPDATE \`${this.tableNames.pets}\` SET \`deleted_at\` = ? WHERE \`user_id\` = ? AND \`deleted_at\` IS NULL`,
      [deletedAt, userId]
    );
  }

  async deleteUserState(userId) {
    this.ensureDataSource();
    await this.dataSource.query(
      `DELETE FROM \`${this.tableNames.userState}\` WHERE \`user_id\` = ?`,
      [userId]
    );
  }

  async deleteUserAndMeta(userId) {
    this.ensureDataSource();

    try {
      await this.dataSource.transaction(async (manager) => {
        await manager.query(
          `DELETE FROM \`${this.tableNames.usermeta}\` WHERE \`user_id\` = ?`,
          [userId]
        );
        const result = await manager.query(
          `DELETE FROM \`${this.tableNames.users}\` WHERE \`ID\` = ?`,
          [userId]
        );

        if (getAffectedRows(result) < 1) {
          throw new HttpError(500, 'Failed to delete account.', { code: 'delete_failed' });
        }
      });
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }

      throw new HttpError(500, 'Failed to delete account.', { code: 'delete_failed' });
    }
  }
}

module.exports = {
  ProfileRepository
};
