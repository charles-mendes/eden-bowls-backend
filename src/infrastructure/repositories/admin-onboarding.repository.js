const { HttpError } = require('../../core/http-error');
const { parseJsonColumn } = require('../../core/stripe-subscription-map');
const { PROFILE_MARKET_META_KEY } = require('../../core/admin-market-scope');

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

  async getCheckout(userId) {
    this.ensureDataSource();
    const normalizedUserId = Number(userId);
    if (!Number.isSafeInteger(normalizedUserId) || normalizedUserId < 1) {
      return null;
    }

    // Pets and the user exist before the state row (it is written on address save or checkout),
    // so start from the user: a customer without a checkout still has pets to show.
    const rows = await this.dataSource.query(
      [
        'SELECT s.`checkout_reference`, s.`plan_selection`, s.`recurrence`, s.`address`, s.`shipping`,',
        's.`payment_reference`, s.`market`, s.`created_at`, s.`updated_at`,',
        'u.ID AS user_id, u.user_email AS email, u.display_name AS displayName,',
        `(SELECT meta_value FROM \`${this.tableNames.usermeta}\` WHERE user_id = u.ID AND meta_key = 'hsr_activation_status' LIMIT 1) AS activationStatus,`,
        `(SELECT meta_value FROM \`${this.tableNames.usermeta}\` WHERE user_id = u.ID AND meta_key = '${PROFILE_MARKET_META_KEY}' LIMIT 1) AS profileMarket`,
        `FROM \`${this.tableNames.users}\` u`,
        `LEFT JOIN \`${this.tableNames.userState}\` s ON s.user_id = u.ID`,
        'WHERE u.ID = ?',
        'LIMIT 1'
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
      market: row.market || row.profileMarket ? String(row.market || row.profileMarket).trim().toUpperCase() : null,
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
}

module.exports = {
  AdminOnboardingRepository,
  parseJsonColumn
};
