const { createScratchDatabase } = require('./helpers/scratch-database');
const { MarketConflictsRepository } = require('../../src/infrastructure/repositories/market-conflicts.repository');
const { applyBackfill, collectBackfillStats } = require('../../src/scripts/backfill-admin-markets');

const runIntegration = process.env.RUN_DB_INTEGRATION_TESTS === 'true';
const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration('market conflicts (MySQL)', () => {
  let db;
  let repository;
  let subscriptionSeq = 0;

  async function addUser(id, email, market) {
    await db.query(
      'INSERT INTO `wp_users` (`ID`, `user_login`, `user_pass`, `user_nicename`, `user_email`) VALUES (?, ?, ?, ?, ?)',
      [id, email, 'x', email, email]
    );
    if (market) {
      await db.query('INSERT INTO `wp_usermeta` (`user_id`, `meta_key`, `meta_value`) VALUES (?, ?, ?)', [id, 'hsr_market_country', market]);
    }
  }

  async function addSubscription(userId, account) {
    subscriptionSeq += 1;
    await db.query(
      'INSERT INTO `stripe_subscriptions` (`user_id`, `stripe_subscription_id`, `stripe_customer_id`, `status`, `stripe_account`) VALUES (?, ?, ?, ?, ?)',
      [userId, `sub_it_${subscriptionSeq}`, `cus_it_${userId}`, 'active', account]
    );
  }

  beforeAll(async () => {
    db = await createScratchDatabase('conflicts', ['wp_users', 'wp_usermeta', 'stripe_subscriptions', 'onboarding_user_state']);
    repository = new MarketConflictsRepository(db.dataSource);
  });

  afterAll(async () => {
    await db.drop();
  });

  beforeEach(async () => {
    for (const table of ['stripe_subscriptions', 'onboarding_user_state', 'wp_usermeta', 'wp_users']) {
      await db.query(`DELETE FROM \`${table}\``);
    }
  });

  test('reports nothing when every profile matches its Stripe account', async () => {
    await addUser(1, 'ana@example.com', 'BR');
    await addSubscription(1, 'br');
    await addUser(2, 'bob@example.com', 'US');
    await addSubscription(2, 'us');

    await expect(repository.list({ offset: 0, perPage: 20 })).resolves.toEqual({ total: 0, items: [] });
    expect((await collectBackfillStats(db.query)).profileVsStripeConflicts).toBe(0);
  });

  test('counts a customer with two subscriptions on the wrong account once and apply leaves them alone', async () => {
    await addUser(1, 'ana@example.com', 'BR');
    await addSubscription(1, 'us');
    await addSubscription(1, 'us');
    await db.query(
      "INSERT INTO `onboarding_user_state` (`user_id`, `address`) VALUES (1, JSON_OBJECT('country', 'US'))"
    );

    await expect(repository.list({ offset: 0, perPage: 20 })).resolves.toEqual({
      total: 1,
      items: [{ userId: '1', email: 'ana@example.com', profileMarket: 'BR', stripeAccount: 'us' }]
    });
    expect((await collectBackfillStats(db.query)).profileVsStripeConflicts).toBe(1);

    await applyBackfill(db.query);

    const profile = await db.query("SELECT `meta_value` FROM `wp_usermeta` WHERE `user_id` = 1 AND `meta_key` = 'hsr_market_country'");
    expect(profile.map((row) => row.meta_value)).toEqual(['BR']);
    const accounts = await db.query('SELECT `stripe_account` FROM `stripe_subscriptions` WHERE `user_id` = 1');
    expect(accounts.map((row) => row.stripe_account)).toEqual(['us', 'us']);
  });

  test('ignores customers without a profile market', async () => {
    await addUser(1, 'ana@example.com', null);
    await addSubscription(1, 'br');

    expect(await repository.count()).toBe(0);
  });

  test('pages rows ordered by e-mail and keeps one row per customer and account', async () => {
    await addUser(1, 'cara@example.com', 'BR');
    await addSubscription(1, 'us');
    await addUser(2, 'ana@example.com', 'US');
    await addSubscription(2, 'br');
    await addUser(3, 'bia@example.com', 'BR');
    await addSubscription(3, 'us');
    await addSubscription(3, 'br');

    const first = await repository.list({ offset: 0, perPage: 2 });
    const second = await repository.list({ offset: 2, perPage: 2 });

    expect(first.total).toBe(3);
    expect(first.items.map((item) => item.email)).toEqual(['ana@example.com', 'bia@example.com']);
    expect(second.items.map((item) => item.email)).toEqual(['cara@example.com']);
    expect((await collectBackfillStats(db.query)).profileVsStripeConflicts).toBe(3);
  });
});
