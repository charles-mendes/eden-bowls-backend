const { HttpError } = require('../../core/http-error');
const { isTerminalStatus, toIso } = require('../../core/privacy');
const { parseJsonColumn } = require('../../core/stripe-subscription-map');

function toSqlDateTime(date) {
  if (!date) {
    return null;
  }
  const value = date instanceof Date ? date : new Date(date);
  return value.toISOString().slice(0, 19).replace('T', ' ');
}

function presentConsent(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    userId: row.user_id == null ? null : Number(row.user_id),
    consentType: String(row.consent_type),
    status: String(row.status),
    documentVersion: row.document_version == null ? null : String(row.document_version),
    source: String(row.source),
    createdAt: toIso(row.created_at)
  };
}

function presentRequest(row, now = new Date()) {
  if (!row) {
    return null;
  }
  const dueAt = toIso(row.due_at);
  const status = String(row.status);
  const overdue = Boolean(dueAt && !isTerminalStatus(status) && new Date(dueAt) < now);
  return {
    id: Number(row.id),
    userId: row.user_id == null ? null : Number(row.user_id),
    type: String(row.type),
    status,
    locale: row.locale == null ? null : String(row.locale),
    market: String(row.market || 'US'),
    payload: parseJsonColumn(row.payload) || {},
    resultNote: row.result_note == null ? null : String(row.result_note),
    dueAt,
    extendedAt: toIso(row.extended_at),
    extensionReason: row.extension_reason == null ? null : String(row.extension_reason),
    identityStatus: String(row.identity_status),
    identityVerifiedAt: toIso(row.identity_verified_at),
    channel: String(row.channel),
    resolvedAt: toIso(row.resolved_at),
    resolvedBy: row.resolved_by == null ? null : Number(row.resolved_by),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    overdue
  };
}

class PrivacyRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tableNames = {
      consents: options.consentsTableName || 'privacy_consents',
      requests: options.requestsTableName || 'privacy_requests',
      users: options.usersTableName || 'wp_users',
      usermeta: options.usermetaTableName || 'wp_usermeta',
      pets: options.petsTableName || 'onboarding_pets',
      userState: options.userStateTableName || 'onboarding_user_state',
      ledger: options.ledgerTableName || 'wp_hsr_stripe_subscriptions'
    };
  }

  ensureDataSource() {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }
  }

  async insertConsent(input) {
    this.ensureDataSource();
    const result = await this.dataSource.query(
      `INSERT INTO \`${this.tableNames.consents}\` (\`user_id\`, \`consent_type\`, \`status\`, \`document_version\`, \`source\`, \`ip_hash\`, \`user_agent\`, \`created_at\`) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.userId || null,
        input.consentType,
        input.status,
        input.documentVersion || null,
        input.source,
        input.ipHash || null,
        input.userAgent || null,
        toSqlDateTime(input.createdAt || new Date())
      ]
    );
    const id = Number(result && (result.insertId || result.insertid) || 0);
    return this.findConsentById(id);
  }

  async findConsentById(id) {
    this.ensureDataSource();
    const rows = await this.dataSource.query(
      `SELECT * FROM \`${this.tableNames.consents}\` WHERE \`id\` = ? LIMIT 1`,
      [id]
    );
    return presentConsent(Array.isArray(rows) ? rows[0] : null);
  }

  async listConsentsForUser(userId) {
    this.ensureDataSource();
    const rows = await this.dataSource.query(
      `SELECT * FROM \`${this.tableNames.consents}\` WHERE \`user_id\` = ? ORDER BY \`created_at\` DESC, \`id\` DESC`,
      [userId]
    );
    return (Array.isArray(rows) ? rows : []).map(presentConsent);
  }

  async getLatestConsent(userId, consentType) {
    this.ensureDataSource();
    const rows = await this.dataSource.query(
      `SELECT * FROM \`${this.tableNames.consents}\` WHERE \`user_id\` = ? AND \`consent_type\` = ? ORDER BY \`created_at\` DESC, \`id\` DESC LIMIT 1`,
      [userId, consentType]
    );
    return presentConsent(Array.isArray(rows) ? rows[0] : null);
  }

  async getLatestCookiePreferences(userId) {
    const [analytics, ads] = await Promise.all([
      this.getLatestConsent(userId, 'analytics'),
      this.getLatestConsent(userId, 'ads')
    ]);
    return {
      analytics: analytics && analytics.status === 'granted' ? 'granted' : analytics ? 'denied' : null,
      ads: ads && ads.status === 'granted' ? 'granted' : ads ? 'denied' : null
    };
  }

  async insertRequest(input) {
    this.ensureDataSource();
    const createdAt = input.createdAt || new Date();
    const result = await this.dataSource.query(
      `INSERT INTO \`${this.tableNames.requests}\` (
        \`user_id\`, \`type\`, \`status\`, \`locale\`, \`market\`, \`payload\`, \`result_note\`,
        \`due_at\`, \`extended_at\`, \`extension_reason\`, \`identity_status\`, \`identity_verified_at\`,
        \`channel\`, \`resolved_at\`, \`resolved_by\`, \`created_at\`, \`updated_at\`
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.userId || null,
        input.type,
        input.status || 'open',
        input.locale || null,
        input.market || 'US',
        input.payload == null ? null : JSON.stringify(input.payload),
        input.resultNote || null,
        toSqlDateTime(input.dueAt),
        toSqlDateTime(input.extendedAt),
        input.extensionReason || null,
        input.identityStatus || 'unverified',
        toSqlDateTime(input.identityVerifiedAt),
        input.channel || 'in_app',
        toSqlDateTime(input.resolvedAt),
        input.resolvedBy || null,
        toSqlDateTime(createdAt),
        toSqlDateTime(createdAt)
      ]
    );
    const id = Number(result && (result.insertId || result.insertid) || 0);
    return this.findRequestById(id);
  }

  async findRequestById(id) {
    this.ensureDataSource();
    const rows = await this.dataSource.query(
      `SELECT * FROM \`${this.tableNames.requests}\` WHERE \`id\` = ? LIMIT 1`,
      [id]
    );
    return presentRequest(Array.isArray(rows) ? rows[0] : null);
  }

  async findRequestByIdentityTokenHash(tokenHash) {
    this.ensureDataSource();
    const rows = await this.dataSource.query(
      `SELECT * FROM \`${this.tableNames.requests}\` WHERE JSON_UNQUOTE(JSON_EXTRACT(\`payload\`, '$.identityTokenHash')) = ? LIMIT 1`,
      [tokenHash]
    );
    return presentRequest(Array.isArray(rows) ? rows[0] : null);
  }

  async listRequestsForUser(userId) {
    this.ensureDataSource();
    const rows = await this.dataSource.query(
      `SELECT * FROM \`${this.tableNames.requests}\` WHERE \`user_id\` = ? ORDER BY \`created_at\` DESC, \`id\` DESC`,
      [userId]
    );
    return (Array.isArray(rows) ? rows : []).map((row) => presentRequest(row));
  }

  async listRequests(query = {}, pagination = {}) {
    this.ensureDataSource();
    const where = [];
    const params = [];

    if (query.status) {
      where.push('`status` = ?');
      params.push(query.status);
    }
    if (query.type) {
      where.push('`type` = ?');
      params.push(query.type);
    }
    if (query.identityStatus) {
      where.push('`identity_status` = ?');
      params.push(query.identityStatus);
    }
    if (query.userId) {
      where.push('`user_id` = ?');
      params.push(query.userId);
    }
    if (Array.isArray(query.markets) && query.markets.length) {
      where.push(`\`market\` IN (${query.markets.map(() => '?').join(', ')})`);
      params.push(...query.markets);
    } else if (query.market) {
      where.push('`market` = ?');
      params.push(query.market);
    }
    if (query.overdue) {
      where.push("`status` NOT IN ('completed', 'rejected') AND `due_at` IS NOT NULL AND `due_at` < ?");
      params.push(toSqlDateTime(query.now || new Date()));
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const nowSql = toSqlDateTime(query.now || new Date());
    const countRows = await this.dataSource.query(
      `SELECT COUNT(*) AS total FROM \`${this.tableNames.requests}\` ${whereSql}`,
      params
    );
    const total = Number(Array.isArray(countRows) && countRows[0] ? countRows[0].total : 0);
    const offset = Number(pagination.offset || 0);
    const perPage = Number(pagination.perPage || 20);
    const rows = await this.dataSource.query(
      `SELECT * FROM \`${this.tableNames.requests}\` ${whereSql}
       ORDER BY CASE WHEN \`status\` NOT IN ('completed', 'rejected') AND \`due_at\` IS NOT NULL AND \`due_at\` < ? THEN 0 ELSE 1 END ASC,
                \`due_at\` IS NULL ASC,
                \`due_at\` ASC,
                \`id\` ASC
       LIMIT ? OFFSET ?`,
      [...params, nowSql, perPage, offset]
    );

    return {
      total,
      items: (Array.isArray(rows) ? rows : []).map((row) => presentRequest(row, query.now || new Date()))
    };
  }

  async updateRequest(id, patch = {}) {
    this.ensureDataSource();
    const fields = [];
    const params = [];
    const map = {
      userId: '`user_id`',
      status: '`status`',
      payload: '`payload`',
      resultNote: '`result_note`',
      dueAt: '`due_at`',
      extendedAt: '`extended_at`',
      extensionReason: '`extension_reason`',
      identityStatus: '`identity_status`',
      identityVerifiedAt: '`identity_verified_at`',
      resolvedAt: '`resolved_at`',
      resolvedBy: '`resolved_by`'
    };

    for (const [key, column] of Object.entries(map)) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        fields.push(`${column} = ?`);
        if (key === 'payload') {
          params.push(patch[key] == null ? null : JSON.stringify(patch[key]));
        } else if (key.endsWith('At') || key === 'dueAt') {
          params.push(toSqlDateTime(patch[key]));
        } else {
          params.push(patch[key] == null ? null : patch[key]);
        }
      }
    }

    if (fields.length === 0) {
      return this.findRequestById(id);
    }

    fields.push('`updated_at` = ?');
    params.push(toSqlDateTime(patch.updatedAt || new Date()));
    params.push(id);

    await this.dataSource.query(
      `UPDATE \`${this.tableNames.requests}\` SET ${fields.join(', ')} WHERE \`id\` = ?`,
      params
    );
    return this.findRequestById(id);
  }

  async listActivePets(userId) {
    this.ensureDataSource();
    const rows = await this.dataSource.query(
      `SELECT \`id\`, \`name\`, \`breed\`, \`age_years\`, \`age_months\`, \`weight_input\`, \`weight_unit\`, \`size\`, \`activity_level\`, \`pet_condition\`, \`neutered\`
       FROM \`${this.tableNames.pets}\` WHERE \`user_id\` = ? AND \`deleted_at\` IS NULL`,
      [userId]
    );
    return Array.isArray(rows) ? rows : [];
  }

  async hardDeletePetsByUserId(userId) {
    this.ensureDataSource();
    await this.dataSource.query(
      `UPDATE \`${this.tableNames.pets}\` SET \`name\` = 'Deleted', \`image_url\` = NULL WHERE \`user_id\` = ?`,
      [userId]
    );
    await this.dataSource.query(
      `DELETE FROM \`${this.tableNames.pets}\` WHERE \`user_id\` = ?`,
      [userId]
    );
  }

  async listSubscriptionSummary(userId) {
    this.ensureDataSource();
    const rows = await this.dataSource.query(
      `SELECT \`id\`, \`status\`, \`stripe_subscription_id\`, \`stripe_customer_id\`, \`current_period_end\`, \`cancel_at_period_end\`
       FROM \`${this.tableNames.ledger}\` WHERE \`user_id\` = ?`,
      [userId]
    );
    return (Array.isArray(rows) ? rows : []).map((row) => ({
      id: Number(row.id),
      status: String(row.status || ''),
      stripeSubscriptionId: row.stripe_subscription_id ? String(row.stripe_subscription_id) : null,
      stripeCustomerId: row.stripe_customer_id ? String(row.stripe_customer_id) : null,
      currentPeriodEnd: toIso(row.current_period_end),
      cancelAtPeriodEnd: Boolean(row.cancel_at_period_end)
    }));
  }
}

module.exports = {
  PrivacyRepository,
  presentConsent,
  presentRequest
};
