const { HttpError } = require('../../core/http-error');
const { AUTH_ERROR } = require('../../api/contracts/auth-errors');

const OTP_META_KEYS = {
  activationStatus: 'hsr_activation_status',
  otpHash: 'hsr_activation_otp_hash',
  otpExpiresAt: 'hsr_activation_otp_expires',
  otpAttempts: 'hsr_activation_otp_attempts',
  otpResendCount: 'hsr_activation_otp_resend_count',
  otpResendWindowStart: 'hsr_activation_otp_resend_window_start',
  emailVerifiedAt: 'hsr_email_verified_at',
  marketingOptIn: 'hsr_marketing_opt_in',
  termsAccepted: 'hsr_terms_accepted',
  privacyAccepted: 'hsr_privacy_accepted'
};

function isDuplicateEntry(error) {
  return Number(error && error.errno) === 1062 || String(error && error.code || '') === 'ER_DUP_ENTRY';
}

function duplicateField(error) {
  const message = String(error && error.message || '').toLowerCase();

  if (message.includes('user_login') || message.includes('uk_wp_users_login')) {
    return 'username';
  }

  return 'email';
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

class AuthRepository {
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

  async findUserForAuthentication(username) {
    this.ensureDataSource();

    const normalized = String(username || '').trim();
    const sql = [
      'SELECT u.ID AS id, u.user_login, u.user_pass, u.user_email, u.user_nicename, u.display_name,',
      "MAX(CASE WHEN um.meta_key = 'hsr_activation_status' THEN um.meta_value END) AS activation_status",
      `FROM \`${this.tableNames.users}\` u`,
      `LEFT JOIN \`${this.tableNames.usermeta}\` um ON um.user_id = u.ID`,
      'WHERE u.user_login = ? OR LOWER(u.user_email) = LOWER(?)',
      'GROUP BY u.ID, u.user_login, u.user_pass, u.user_email, u.user_nicename, u.display_name',
      'LIMIT 1'
    ].join(' ');

    const rows = await this.dataSource.query(sql, [normalized, normalized]);
    return this.mapAuthUser(Array.isArray(rows) ? rows[0] : null);
  }

  async findUserById(userId) {
    this.ensureDataSource();

    const normalizedUserId = Number(userId);
    if (!Number.isSafeInteger(normalizedUserId) || normalizedUserId < 1) {
      return null;
    }

    const sql = [
      'SELECT u.ID AS id, u.user_email, u.user_nicename, u.display_name,',
      "MAX(CASE WHEN um.meta_key = 'hsr_activation_status' THEN um.meta_value END) AS activation_status",
      `FROM \`${this.tableNames.users}\` u`,
      `LEFT JOIN \`${this.tableNames.usermeta}\` um ON um.user_id = u.ID`,
      'WHERE u.ID = ?',
      'GROUP BY u.ID, u.user_email, u.user_nicename, u.display_name',
      'LIMIT 1'
    ].join(' ');
    const rows = await this.dataSource.query(sql, [normalizedUserId]);
    const user = Array.isArray(rows) ? rows[0] : null;

    if (!user) {
      return null;
    }

    return {
      id: Number(user.id),
      user_email: String(user.user_email || ''),
      user_nicename: String(user.user_nicename || ''),
      display_name: String(user.display_name || ''),
      activation_status: String(user.activation_status || '').trim().toLowerCase()
    };
  }

  async emailExists(email) {
    this.ensureDataSource();

    const normalized = String(email || '').trim().toLowerCase();
    const sql = [
      'SELECT u.ID AS id',
      `FROM \`${this.tableNames.users}\` u`,
      'WHERE LOWER(u.user_email) = ?',
      'LIMIT 1'
    ].join(' ');
    const rows = await this.dataSource.query(sql, [normalized]);

    return Array.isArray(rows) && rows.length > 0;
  }

  async createPendingUser(record) {
    this.ensureDataSource();

    try {
      return await this.dataSource.transaction(async (manager) => {
        const result = await manager.query(
          [
            `INSERT INTO \`${this.tableNames.users}\``,
            '(`user_login`, `user_pass`, `user_nicename`, `user_email`, `display_name`)',
            'VALUES (?, ?, ?, ?, ?)'
          ].join(' '),
          [record.userLogin, record.userPass, record.userNicename, record.userEmail, record.displayName]
        );
        const userId = readInsertId(result);

        if (!Number.isSafeInteger(userId) || userId < 1) {
          throw new HttpError(503, 'Unable to create account.');
        }

        await this.upsertUserMetaWithManager(manager, userId, OTP_META_KEYS.activationStatus, 'pending');
        await this.upsertUserMetaWithManager(manager, userId, OTP_META_KEYS.otpHash, record.otpHash);
        await this.upsertUserMetaWithManager(manager, userId, OTP_META_KEYS.otpExpiresAt, String(record.otpExpiresAt));
        await this.upsertUserMetaWithManager(manager, userId, OTP_META_KEYS.otpAttempts, '0');

        return {
          id: userId,
          user_email: record.userEmail
        };
      });
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }

      if (isDuplicateEntry(error)) {
        const field = duplicateField(error);
        const authError = field === 'username' ? AUTH_ERROR.USERNAME_EXISTS : AUTH_ERROR.EMAIL_EXISTS;
        throw new HttpError(authError.status, authError.message, {
          code: authError.code,
          field
        });
      }

      throw error;
    }
  }

  async findUserForOtp(userId) {
    this.ensureDataSource();

    const normalizedUserId = Number(userId);
    if (!Number.isSafeInteger(normalizedUserId) || normalizedUserId < 1) {
      return null;
    }

    const sql = [
      'SELECT u.ID AS id, u.user_email,',
      `MAX(CASE WHEN um.meta_key = '${OTP_META_KEYS.activationStatus}' THEN um.meta_value END) AS activation_status,`,
      `MAX(CASE WHEN um.meta_key = '${OTP_META_KEYS.otpHash}' THEN um.meta_value END) AS otp_hash,`,
      `MAX(CASE WHEN um.meta_key = '${OTP_META_KEYS.otpExpiresAt}' THEN um.meta_value END) AS otp_expires_at,`,
      `MAX(CASE WHEN um.meta_key = '${OTP_META_KEYS.otpAttempts}' THEN um.meta_value END) AS otp_attempts,`,
      `MAX(CASE WHEN um.meta_key = '${OTP_META_KEYS.otpResendCount}' THEN um.meta_value END) AS otp_resend_count,`,
      `MAX(CASE WHEN um.meta_key = '${OTP_META_KEYS.otpResendWindowStart}' THEN um.meta_value END) AS otp_resend_window_start`,
      `FROM \`${this.tableNames.users}\` u`,
      `LEFT JOIN \`${this.tableNames.usermeta}\` um ON um.user_id = u.ID`,
      'WHERE u.ID = ?',
      'GROUP BY u.ID, u.user_email',
      'LIMIT 1'
    ].join(' ');
    const rows = await this.dataSource.query(sql, [normalizedUserId]);
    const user = Array.isArray(rows) ? rows[0] : null;

    if (!user) {
      return null;
    }

    return {
      id: Number(user.id),
      user_email: String(user.user_email || ''),
      activation_status: String(user.activation_status || '').trim().toLowerCase(),
      otp_hash: String(user.otp_hash || ''),
      otp_expires_at: Number(user.otp_expires_at || 0),
      otp_attempts: Number(user.otp_attempts || 0),
      otp_resend_count: Number(user.otp_resend_count || 0),
      otp_resend_window_start: Number(user.otp_resend_window_start || 0)
    };
  }

  async saveOtpChallenge(userId, challenge) {
    this.ensureDataSource();

    await this.dataSource.transaction(async (manager) => {
      await this.upsertUserMetaWithManager(manager, userId, OTP_META_KEYS.otpHash, challenge.otpHash);
      await this.upsertUserMetaWithManager(manager, userId, OTP_META_KEYS.otpExpiresAt, String(challenge.otpExpiresAt));
      await this.upsertUserMetaWithManager(manager, userId, OTP_META_KEYS.otpAttempts, String(challenge.attempts || 0));
    });
  }

  async saveOtpAttempts(userId, attempts) {
    this.ensureDataSource();
    await this.upsertUserMeta(userId, OTP_META_KEYS.otpAttempts, String(attempts));
  }

  async saveOtpResendState(userId, state) {
    this.ensureDataSource();

    await this.dataSource.transaction(async (manager) => {
      await this.upsertUserMetaWithManager(manager, userId, OTP_META_KEYS.otpResendCount, String(state.count || 0));
      await this.upsertUserMetaWithManager(manager, userId, OTP_META_KEYS.otpResendWindowStart, String(state.windowStart || 0));
    });
  }

  async activateUser(userId, consents = {}) {
    this.ensureDataSource();

    await this.dataSource.transaction(async (manager) => {
      await this.upsertUserMetaWithManager(manager, userId, OTP_META_KEYS.activationStatus, 'active');
      await this.upsertUserMetaWithManager(manager, userId, OTP_META_KEYS.emailVerifiedAt, consents.emailVerifiedAt || new Date().toISOString());
      await this.upsertUserMetaWithManager(manager, userId, OTP_META_KEYS.marketingOptIn, consents.marketingOptIn ? '1' : '0');
      await this.upsertUserMetaWithManager(manager, userId, OTP_META_KEYS.termsAccepted, consents.termsAccepted ? '1' : '0');
      await this.upsertUserMetaWithManager(manager, userId, OTP_META_KEYS.privacyAccepted, consents.privacyAccepted ? '1' : '0');
      await this.deleteUserMetaWithManager(manager, userId, OTP_META_KEYS.otpHash);
      await this.deleteUserMetaWithManager(manager, userId, OTP_META_KEYS.otpExpiresAt);
      await this.deleteUserMetaWithManager(manager, userId, OTP_META_KEYS.otpAttempts);
      await this.deleteUserMetaWithManager(manager, userId, OTP_META_KEYS.otpResendCount);
      await this.deleteUserMetaWithManager(manager, userId, OTP_META_KEYS.otpResendWindowStart);
    });
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

  async upsertUserMeta(userId, metaKey, metaValue) {
    this.ensureDataSource();
    await this.upsertUserMetaWithManager(this.dataSource, userId, metaKey, metaValue);
  }

  async upsertUserMetaWithManager(manager, userId, metaKey, metaValue) {
    const existing = await manager.query(
      [
        'SELECT `umeta_id` AS id',
        `FROM \`${this.tableNames.usermeta}\``,
        'WHERE `user_id` = ? AND `meta_key` = ?',
        'LIMIT 1'
      ].join(' '),
      [userId, metaKey]
    );
    const row = Array.isArray(existing) ? existing[0] : null;

    if (row && row.id) {
      await manager.query(
        `UPDATE \`${this.tableNames.usermeta}\` SET \`meta_value\` = ? WHERE \`umeta_id\` = ?`,
        [metaValue, row.id]
      );
      return;
    }

    await manager.query(
      `INSERT INTO \`${this.tableNames.usermeta}\` (\`user_id\`, \`meta_key\`, \`meta_value\`) VALUES (?, ?, ?)`,
      [userId, metaKey, metaValue]
    );
  }

  async deleteUserMetaWithManager(manager, userId, metaKey) {
    await manager.query(
      `DELETE FROM \`${this.tableNames.usermeta}\` WHERE \`user_id\` = ? AND \`meta_key\` = ?`,
      [userId, metaKey]
    );
  }

  mapAuthUser(user) {
    if (!user) {
      return null;
    }

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
  AuthRepository,
  OTP_META_KEYS
};
