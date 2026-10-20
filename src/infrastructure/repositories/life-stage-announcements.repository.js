const { HttpError } = require('../../core/http-error');
const { parseJsonColumn } = require('../../core/stripe-subscription-map');
const { toIsoDateTime, toIsoDay } = require('./onboarding-pets.repository');

// Plans that still deliver: the same set the age edit treats as affected (pet-life-stage).
const DELIVERING_STATUSES = ['active', 'trialing', 'past_due'];

// Launch announcement per market (design decision 9): who may receive it and what was already sent.
class LifeStageAnnouncementsRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tables = {
      subscriptions: options.subscriptionsTableName || 'stripe_subscriptions',
      pets: options.petsTableName || 'onboarding_pets',
      users: options.usersTableName || 'wp_users',
      usermeta: options.usermetaTableName || 'wp_usermeta'
    };
  }

  ensureDataSource() {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }
  }

  // The market's announcement state: `sent_at` turns on the stage-change email there.
  async findMarket(market) {
    this.ensureDataSource();
    const rows = await this.dataSource.query(
      'SELECT market, started_at, sent_at FROM life_stage_announcements WHERE market = ? LIMIT 1',
      [String(market || '').toUpperCase()]
    );
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  }

  // First real send of the market; a later run keeps the first date.
  async markStarted(market, at) {
    this.ensureDataSource();
    await this.dataSource.query(
      `INSERT INTO life_stage_announcements (market, started_at) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE started_at = COALESCE(started_at, VALUES(started_at))`,
      [String(market).toUpperCase(), at]
    );
  }

  // Last batch done: turns on the stage-change email of the market.
  async markSent(market, at) {
    this.ensureDataSource();
    await this.dataSource.query(
      'UPDATE life_stage_announcements SET sent_at = COALESCE(sent_at, ?) WHERE market = ?',
      [at, String(market).toUpperCase()]
    );
  }

  // Customers of the market whose pets were marked as announced since `since` (the daily cap).
  async countAnnouncedCustomersSince(stripeAccount, since) {
    this.ensureDataSource();
    const rows = await this.dataSource.query(
      `SELECT COUNT(DISTINCT p.user_id) AS total
       FROM \`${this.tables.pets}\` p
       WHERE p.life_stage_announced_at >= ?
         AND p.user_id IN (SELECT s.user_id FROM \`${this.tables.subscriptions}\` s WHERE s.stripe_account = ?)`,
      [since, String(stripeAccount || '').toLowerCase()]
    );
    return Number(rows && rows[0] && rows[0].total) || 0;
  }

  // Named pets keep the stage they were announced for.
  async markPetsAnnounced(dogs, at) {
    this.ensureDataSource();
    for (const dog of dogs) {
      await this.dataSource.query(
        `UPDATE \`${this.tables.pets}\` SET life_stage_announced_at = ?, life_stage_announced_stage = ?
         WHERE id = ? AND life_stage_announced_at IS NULL`,
        [at, dog.stage, dog.petId]
      );
    }
  }

  // Delivering plans of a Stripe account whose owner opted in to marketing (`hsr_marketing_opt_in` = '1'),
  // each with the owner's pets not yet named in an announcement.
  async listCandidates(stripeAccount) {
    this.ensureDataSource();
    const { subscriptions, pets, users, usermeta } = this.tables;
    const rows = await this.dataSource.query(
      `SELECT s.id, s.user_id, s.stripe_subscription_id, s.stripe_account, s.customer_email, s.address,
              s.plan_selection, u.user_email
       FROM \`${subscriptions}\` s
       JOIN \`${usermeta}\` m ON m.user_id = s.user_id AND m.meta_key = 'hsr_marketing_opt_in' AND m.meta_value = '1'
       LEFT JOIN \`${users}\` u ON u.ID = s.user_id
       WHERE s.stripe_account = ? AND s.status IN (${DELIVERING_STATUSES.map(() => '?').join(', ')})
       ORDER BY s.user_id ASC, s.id ASC`,
      [String(stripeAccount || '').toLowerCase(), ...DELIVERING_STATUSES]
    );
    const plans = Array.isArray(rows) ? rows : [];
    const userIds = [...new Set(plans.map((row) => Number(row.user_id)).filter((id) => id > 0))];
    if (userIds.length === 0) {
      return [];
    }

    const petRows = await this.dataSource.query(
      `SELECT id, user_id, name, breed, size, age_years, age_months, age_recorded_at, birth_date
       FROM \`${pets}\`
       WHERE user_id IN (${userIds.map(() => '?').join(', ')}) AND deleted_at IS NULL AND life_stage_announced_at IS NULL`,
      userIds
    );
    const petsByUser = new Map();
    for (const pet of Array.isArray(petRows) ? petRows : []) {
      const list = petsByUser.get(Number(pet.user_id)) || [];
      list.push({
        id: String(pet.id),
        name: String(pet.name || ''),
        breed: String(pet.breed || ''),
        size: String(pet.size || ''),
        age_years: Number(pet.age_years || 0),
        age_months: Number(pet.age_months || 0),
        age_recorded_at: toIsoDateTime(pet.age_recorded_at),
        birth_date: toIsoDay(pet.birth_date)
      });
      petsByUser.set(Number(pet.user_id), list);
    }

    return plans.map((row) => ({
      id: Number(row.id),
      userId: Number(row.user_id),
      stripeSubscriptionId: String(row.stripe_subscription_id || ''),
      stripeAccount: String(row.stripe_account || ''),
      email: String(row.customer_email || row.user_email || '').trim(),
      address: parseJsonColumn(row.address) || {},
      planSelection: parseJsonColumn(row.plan_selection) || {},
      pets: petsByUser.get(Number(row.user_id)) || []
    }));
  }
}

module.exports = {
  DELIVERING_STATUSES,
  LifeStageAnnouncementsRepository
};
