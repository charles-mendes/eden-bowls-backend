const { DataSource } = require('typeorm');
const { SubscriptionLedgerRepository } = require('../../src/infrastructure/repositories/subscription-ledger.repository');
const { OnboardingSubscriptionCheckoutRepository } = require('../../src/infrastructure/repositories/onboarding-subscription-checkout.repository');

const runIntegration = process.env.RUN_DB_INTEGRATION_TESTS === 'true';
const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration('checkout reference owner (MySQL)', () => {
  const table = `it_${Date.now()}_checkout_owner_state`;
  const dataSource = new DataSource({
    type: 'mysql',
    host: process.env.INTEGRATION_DB_HOST || '127.0.0.1',
    port: Number(process.env.INTEGRATION_DB_PORT || 3310),
    username: process.env.INTEGRATION_DB_USER || 'root',
    password: process.env.INTEGRATION_DB_PASSWORD || 'root',
    database: process.env.INTEGRATION_DB_NAME || 'eden_bowls',
    charset: 'utf8mb4',
    timezone: 'Z',
    entities: [],
    migrations: [],
    synchronize: false,
    logging: false
  });
  const ledger = () => new SubscriptionLedgerRepository(dataSource, { userStateTableName: table });
  const checkouts = () => new OnboardingSubscriptionCheckoutRepository(dataSource, { tableName: table });

  const checkoutOf = async (userId) => {
    const [row] = await dataSource.query(`SELECT checkout_reference FROM \`${table}\` WHERE user_id = ?`, [userId]);
    return typeof row.checkout_reference === 'string' ? JSON.parse(row.checkout_reference) : row.checkout_reference;
  };
  const seed = (userId, reference) => dataSource.query(
    `INSERT INTO \`${table}\` (user_id, checkout_reference) VALUES (?, ?)`,
    [userId, JSON.stringify(reference)]
  );

  beforeAll(async () => {
    await dataSource.initialize();
    // LIKE copies the columns without the foreign key to the users table.
    await dataSource.query(`CREATE TABLE \`${table}\` LIKE \`onboarding_user_state\``);
  });

  afterAll(async () => {
    if (dataSource.isInitialized) {
      await dataSource.query(`DROP TABLE IF EXISTS \`${table}\``);
      await dataSource.destroy();
    }
  });

  test('the owner patch merges like the spread, keeping fields and null keys', async () => {
    const reference = {
      order_key: 'sub_sub_b',
      stripe_subscription_id: 'sub_b',
      stripe_payment_intent_id: 'pi_b',
      payment_state: 'requires_confirmation',
      stripe_promotion_code_id: null,
      total: 129.9,
      pet_ids: ['p1']
    };
    await seed(9101, reference);
    const patch = { payment_state: 'paid', stripe_subscription_id: 'sub_b', stripe_invoice_id: 'in_b', stripe_coupon_id: null };

    expect(await ledger().updateCheckoutReference(9101, patch, { subscriptionId: 'sub_b' })).toBe(true);
    expect(await checkoutOf(9101)).toEqual({ ...reference, ...patch });
  });

  test('a patch from another subscription or payment intent leaves the checkout as it was', async () => {
    const reference = { stripe_subscription_id: 'sub_b', stripe_payment_intent_id: 'pi_b', payment_state: 'paid', stripe_invoice_id: 'in_b' };
    await seed(9102, reference);

    expect(await ledger().updateCheckoutReference(9102, { payment_state: 'paid', stripe_subscription_id: 'sub_a', stripe_invoice_id: 'in_a' }, { subscriptionId: 'sub_a' })).toBe(false);
    expect(await ledger().updateCheckoutReference(9102, { payment_state: 'failed', stripe_payment_intent_id: 'pi_a' }, { subscriptionId: 'sub_a', paymentIntentId: 'pi_a' })).toBe(false);
    expect(await checkoutOf(9102)).toEqual(reference);
  });

  test('an empty id on both sides is not an owner', async () => {
    const reference = { stripe_subscription_id: '', payment_state: 'pending_payment_method' };
    await seed(9103, reference);

    expect(await ledger().updateCheckoutReference(9103, { payment_state: 'paid' }, { subscriptionId: '', paymentIntentId: '' })).toBe(false);
    expect(await checkoutOf(9103)).toEqual(reference);
  });

  test('a charge processed before the new checkout is written leaves no trace of the old subscription', async () => {
    // The row still holds the previous checkout (subscription A) while subscription B is being created.
    await seed(9104, { order_key: 'sub_sub_a', stripe_subscription_id: 'sub_a', payment_state: 'paid', pet_ids: ['old'] });

    expect(await ledger().updateCheckoutReference(9104, { payment_state: 'paid', stripe_subscription_id: 'sub_b', stripe_invoice_id: 'in_b1' }, { subscriptionId: 'sub_b' })).toBe(false);
    await ledger().updateCheckoutReference(9104, { payment_state: 'paid', stripe_subscription_id: 'sub_a', stripe_invoice_id: 'in_a7' }, { subscriptionId: 'sub_a' });

    await checkouts().checkout(9104, {
      checkout: { order_key: 'sub_sub_b', stripe_subscription_id: 'sub_b', stripe_payment_intent_id: 'pi_b', payment_state: 'paid', pet_ids: ['new'] }
    });

    expect(await checkoutOf(9104)).toEqual({
      order_key: 'sub_sub_b',
      stripe_subscription_id: 'sub_b',
      stripe_payment_intent_id: 'pi_b',
      payment_state: 'paid',
      pet_ids: ['new']
    });

    // After the write, the old subscription's charges no longer reach it and the new one's do.
    expect(await ledger().updateCheckoutReference(9104, { stripe_invoice_id: 'in_a8' }, { subscriptionId: 'sub_a' })).toBe(false);
    expect(await ledger().updateCheckoutReference(9104, { stripe_invoice_id: 'in_b2' }, { subscriptionId: 'sub_b' })).toBe(true);
    expect((await checkoutOf(9104)).stripe_invoice_id).toBe('in_b2');
  });
});
