const { HttpError } = require('../../core/http-error');
const { parseJsonColumn } = require('../../core/stripe-subscription-map');

function isMissingTableError(error) {
  const message = String(error && error.message ? error.message : '');
  return Boolean(
    error && (
      error.code === 'ER_NO_SUCH_TABLE' ||
      error.errno === 1146 ||
      /doesn't exist/i.test(message)
    )
  );
}

function safeJson(value) {
  if (value == null || value === '') {
    return null;
  }

  if (typeof value === 'object') {
    return value;
  }

  try {
    return JSON.parse(String(value));
  } catch (_error) {
    return { _raw: String(value), _warning: 'invalid_json' };
  }
}

class AdminOnboardingRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tableNames = {
      users: options.usersTableName || 'wp_users',
      usermeta: options.usermetaTableName || 'wp_usermeta',
      userState: options.userStateTableName || 'onboarding_user_state',
      pets: options.petsTableName || 'onboarding_pets',
      subscriptions: options.subscriptionsTableName || 'stripe_subscriptions'
    };
  }

  ensureDataSource() {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }
  }

  buildFilters(query = {}) {
    const where = ['s.checkout_reference IS NOT NULL'];
    const params = [];

    if (query.email) {
      where.push('LOWER(u.user_email) LIKE ?');
      params.push(`%${String(query.email).trim().toLowerCase()}%`);
    }

    if (query.userId) {
      where.push('s.user_id = ?');
      params.push(Number(query.userId));
    }

    if (query.stripeSubscriptionId) {
      where.push(`EXISTS (
        SELECT 1 FROM \`${this.tableNames.subscriptions}\` sub
        WHERE sub.user_id = s.user_id AND sub.stripe_subscription_id = ?
      )`);
      params.push(String(query.stripeSubscriptionId).trim());
    }

    if (query.stripeStatus) {
      where.push(`EXISTS (
        SELECT 1 FROM \`${this.tableNames.subscriptions}\` sub
        WHERE sub.user_id = s.user_id AND sub.status = ?
      )`);
      params.push(String(query.stripeStatus).trim());
    }

    if (query.link === 'linked') {
      where.push(`EXISTS (SELECT 1 FROM \`${this.tableNames.subscriptions}\` sub WHERE sub.user_id = s.user_id)`);
    }

    if (query.link === 'unlinked') {
      where.push(`NOT EXISTS (SELECT 1 FROM \`${this.tableNames.subscriptions}\` sub WHERE sub.user_id = s.user_id)`);
    }

    if (query.frequency) {
      where.push("JSON_UNQUOTE(JSON_EXTRACT(s.recurrence, '$.frequency')) = ?");
      params.push(String(query.frequency).trim());
    }

    if (query.market) {
      where.push("UPPER(JSON_UNQUOTE(JSON_EXTRACT(s.address, '$.country'))) = ?");
      params.push(String(query.market).trim().toUpperCase());
    }

    if (query.from) {
      where.push('s.updated_at >= ?');
      params.push(query.from);
    }

    if (query.to) {
      where.push('s.updated_at <= ?');
      params.push(query.to);
    }

    return { where: where.join(' AND '), params };
  }

  async listCheckouts(query = {}, pagination = { offset: 0, perPage: 20 }) {
    this.ensureDataSource();
    const { where, params } = this.buildFilters(query);

    try {
      const countRows = await this.dataSource.query(
        [
          `SELECT COUNT(*) AS total`,
          `FROM \`${this.tableNames.userState}\` s`,
          `INNER JOIN \`${this.tableNames.users}\` u ON u.ID = s.user_id`,
          `WHERE ${where}`
        ].join(' '),
        params
      );
      const total = Number(Array.isArray(countRows) && countRows[0] ? countRows[0].total : 0);
      const rows = await this.dataSource.query(
        [
          'SELECT s.user_id AS userId, u.user_email AS email, u.display_name AS displayName,',
          "MAX(CASE WHEN um.meta_key = 'hsr_activation_status' THEN um.meta_value END) AS activationStatus,",
          's.updated_at AS updatedAt, s.created_at AS createdAt, s.checkout_reference AS checkoutReference,',
          's.plan_selection AS planSelection, s.recurrence AS recurrence, s.address AS address, s.shipping AS shipping,',
          `(SELECT COUNT(*) FROM \`${this.tableNames.pets}\` p WHERE p.user_id = s.user_id AND p.deleted_at IS NULL) AS petCount,`,
          `(SELECT COUNT(*) FROM \`${this.tableNames.subscriptions}\` sub WHERE sub.user_id = s.user_id) AS subscriptionCount,`,
          `(SELECT sub.status FROM \`${this.tableNames.subscriptions}\` sub WHERE sub.user_id = s.user_id ORDER BY COALESCE(sub.updated_at, sub.created_at) DESC LIMIT 1) AS stripeStatus,`,
          `(SELECT sub.stripe_subscription_id FROM \`${this.tableNames.subscriptions}\` sub WHERE sub.user_id = s.user_id ORDER BY COALESCE(sub.updated_at, sub.created_at) DESC LIMIT 1) AS stripeSubscriptionId`,
          `FROM \`${this.tableNames.userState}\` s`,
          `INNER JOIN \`${this.tableNames.users}\` u ON u.ID = s.user_id`,
          `LEFT JOIN \`${this.tableNames.usermeta}\` um ON um.user_id = u.ID`,
          `WHERE ${where}`,
          'GROUP BY s.user_id, u.user_email, u.display_name, s.updated_at, s.created_at, s.checkout_reference, s.plan_selection, s.recurrence, s.address, s.shipping',
          'ORDER BY s.updated_at DESC',
          'LIMIT ? OFFSET ?'
        ].join(' '),
        [...params, pagination.perPage, pagination.offset]
      );

      return {
        total,
        items: (Array.isArray(rows) ? rows : []).map((row) => this.mapListRow(row))
      };
    } catch (error) {
      if (isMissingTableError(error)) {
        return { total: 0, items: [] };
      }
      throw error;
    }
  }

  mapListRow(row) {
    const checkout = safeJson(row.checkoutReference);
    const planSelection = safeJson(row.planSelection);
    const recurrence = safeJson(row.recurrence);
    const subscriptionCount = Number(row.subscriptionCount || 0);

    return {
      userId: String(row.userId),
      email: String(row.email || ''),
      displayName: String(row.displayName || ''),
      activationStatus: String(row.activationStatus || '').trim().toLowerCase() || 'active',
      updatedAt: row.updatedAt,
      createdAt: row.createdAt,
      petCount: Number(row.petCount || 0),
      subscriptionCount,
      stripeStatus: subscriptionCount > 1 && row.stripeStatus ? 'mixed' : (row.stripeStatus || 'unlinked'),
      stripeSubscriptionId: subscriptionCount > 1
        ? `${subscriptionCount} vinculadas`
        : (row.stripeSubscriptionId || 'Não vinculado'),
      frequency: recurrence && recurrence.frequency ? recurrence.frequency : null,
      termMonths: planSelection && planSelection.subscription_term_months
        ? Number(planSelection.subscription_term_months)
        : null,
      firstInvoiceTotal: checkout && checkout.stripe_amount_paid != null ? checkout.stripe_amount_paid : null,
      market: row.address && safeJson(row.address) && safeJson(row.address).country
        ? String(safeJson(row.address).country).toUpperCase()
        : null
    };
  }

  async getCheckout(userId) {
    this.ensureDataSource();
    const normalizedUserId = Number(userId);
    if (!Number.isSafeInteger(normalizedUserId) || normalizedUserId < 1) {
      return null;
    }

    const rows = await this.dataSource.query(
      [
        'SELECT s.*, u.user_email AS email, u.display_name AS displayName,',
        "MAX(CASE WHEN um.meta_key = 'hsr_activation_status' THEN um.meta_value END) AS activationStatus",
        `FROM \`${this.tableNames.userState}\` s`,
        `INNER JOIN \`${this.tableNames.users}\` u ON u.ID = s.user_id`,
        `LEFT JOIN \`${this.tableNames.usermeta}\` um ON um.user_id = u.ID`,
        'WHERE s.user_id = ?',
        'GROUP BY s.user_id'
      ].join(' '),
      [normalizedUserId]
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) {
      return null;
    }

    const pets = await this.dataSource.query(
      [
        'SELECT `id`, `name`, `breed`, `age_years`, `age_months`, `weight_input`, `weight_unit`,',
        '`size`, `activity_level`, `pet_condition`, `neutered`',
        `FROM \`${this.tableNames.pets}\``,
        'WHERE `user_id` = ? AND `deleted_at` IS NULL',
        'ORDER BY `created_at` ASC'
      ].join(' '),
      [normalizedUserId]
    );

    return {
      userId: String(row.user_id),
      email: String(row.email || ''),
      displayName: String(row.displayName || ''),
      activationStatus: String(row.activationStatus || '').trim().toLowerCase() || 'active',
      updatedAt: row.updated_at,
      createdAt: row.created_at,
      checkoutReference: safeJson(row.checkout_reference),
      planSelection: safeJson(row.plan_selection),
      recurrence: safeJson(row.recurrence),
      address: safeJson(row.address),
      shipping: safeJson(row.shipping),
      paymentReference: safeJson(row.payment_reference),
      pets: (Array.isArray(pets) ? pets : []).map((pet) => ({
        id: String(pet.id),
        name: String(pet.name || '') || 'Unnamed pet',
        breed: String(pet.breed || ''),
        ageYears: Number(pet.age_years || 0),
        ageMonths: Number(pet.age_months || 0),
        weightInput: Number(pet.weight_input || 0),
        weightUnit: pet.weight_unit === 'lb' ? 'lb' : 'kg',
        size: String(pet.size || ''),
        activityLevel: String(pet.activity_level || ''),
        petCondition: String(pet.pet_condition || ''),
        neutered: Boolean(pet.neutered)
      }))
    };
  }

  async metrics(query = {}) {
    const { total, items } = await this.listCheckouts(query, { offset: 0, perPage: 100000 });
    const linked = items.filter((item) => item.subscriptionCount > 0).length;
    const stripeActive = items.filter((item) => item.stripeStatus === 'active' || item.stripeStatus === 'trialing' || item.stripeStatus === 'mixed').length;

    return {
      totalCheckouts: total,
      linkedToStripe: linked,
      stripeActive,
      withSimplified: items.filter((item) => item.petCount > 0).length,
      generatedAt: new Date().toISOString()
    };
  }
}

module.exports = {
  AdminOnboardingRepository,
  parseJsonColumn
};
