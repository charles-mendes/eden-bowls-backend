require('dotenv').config();

const { DateTime } = require('luxon');
const { parseEnv } = require('../config/env');
const { createDataSource } = require('../infrastructure/db');
const { StripeBillingClient } = require('../infrastructure/stripe/stripe-billing-client');
const { SubscriptionLedgerRepository } = require('../infrastructure/repositories/subscription-ledger.repository');
const { SubscriptionProductionRepository } = require('../infrastructure/repositories/subscription-production.repository');
const { SubscriptionDeliveriesRepository } = require('../infrastructure/repositories/subscription-deliveries.repository');
const { DeliveryClosedDaysRepository } = require('../infrastructure/repositories/delivery-closed-days.repository');
const { SubscriptionsEditCommitRepository } = require('../infrastructure/repositories/subscriptions-edit-commit.repository');
const { StripeWebhookService } = require('../services/stripe-webhook.service');
const { CustomerDeliveriesService } = require('../services/customer-deliveries.service');
const { SubscriptionsEditCommitService } = require('../services/subscriptions-edit-commit.service');
const { PendingDeliveryChangesService } = require('../services/pending-delivery-changes.service');
const { buildCurrentHash } = require('../core/subscription-edit-hash');
const { extractSubscriptionIdFromInvoice, extractSubscriptionPeriod } = require('../core/stripe-subscription-map');
const { TIMEZONE_BR, wallTimeToUtc } = require('../core/delivery-closed-days');

// Brazil. The first charge is Saturday 7 Nov 2026 14:00, so the current renewal is Monday 7 Dec 14:00 and the
// following one is Thursday 7 Jan 2027 14:00 (delivered Friday 8 Jan). At Monday 7 Dec 10:00 the current
// delivery is past its deadline (end of 6 Dec) and unpaid, so the actions sit on the following delivery.
// Skipping it lands on the charge of 7 Feb 2027 (Sunday), whose first valid preparation day is Wednesday
// 10 Feb, after Carnival Monday and Tuesday.
const API_VERSION = '2025-09-30.clover';
const CLOCK_NAME = 'redesign-my-plan-following-delivery';
const CHECK_KEY = 'redesign-my-plan-following';
const ZONE = TIMEZONE_BR;
const UNIT_AMOUNT = 18990;
const START = [2026, 11, 7, 14, 0];
const LOCKED_AT = [2026, 12, 7, 10, 0];
const AFTER_CHARGE = [2026, 12, 7, 16, 0];
const EXPECTED_SKIP = [2027, 2, 10];
const RESCHEDULE_TO = '2027-01-15';
const WATCHED = ['invoice.paid', 'customer.subscription.updated'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const unixAt = ([year, month, day, hour = 0, minute = 0]) => Math.floor(wallTimeToUtc(year, month, day, hour, minute, 0, ZONE).getTime() / 1000);
const local = (unix) => (typeof unix === 'number' ? DateTime.fromSeconds(unix, { zone: ZONE }).toFormat('yyyy-LL-dd HH:mm ccc') : unix);

async function waitForClock(stripe, clockId) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const clock = await stripe.testHelpers.testClocks.retrieve(clockId);
    if (clock.status === 'ready') return clock;
    await sleep(3000);
  }
  throw new Error(`Test clock ${clockId} did not become ready.`);
}

async function reusablePrice(stripe) {
  const lookupKey = `${CHECK_KEY}-brl-${UNIT_AMOUNT}`;
  const listed = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1 });
  if (listed.data[0]) {
    return listed.data[0].active ? listed.data[0] : stripe.prices.update(listed.data[0].id, { active: true });
  }
  const product = await stripe.products.create({ name: 'My Plan following delivery check', metadata: { eden_check: CHECK_KEY } });
  return stripe.prices.create({
    product: product.id,
    currency: 'brl',
    unit_amount: UNIT_AMOUNT,
    recurring: { interval: 'month' },
    lookup_key: lookupKey,
    transfer_lookup_key: true
  });
}

async function main() {
  const env = parseEnv();
  if (!String(process.env.EDEN_RUNTIME || '').trim()) process.env.EDEN_RUNTIME = 'sandbox-following-check';
  const secret = env.STRIPE_BR_SECRET_KEY;
  if (!secret || !secret.startsWith('sk_test_')) throw new Error('STRIPE_BR_SECRET_KEY is not a test key.');
  const stripe = require('stripe')(secret, { apiVersion: API_VERSION });
  const billing = new StripeBillingClient({ account: 'br', secretKey: secret, apiVersion: API_VERSION });
  const dataSource = createDataSource(env);
  await dataSource.initialize();
  const report = {};
  const subscriptionIds = [];
  let clock;
  let price;
  try {
    const users = await dataSource.query('SELECT ID AS id FROM wp_users ORDER BY ID ASC LIMIT 1');
    const userId = users[0] && users[0].id;
    if (!userId) throw new Error('No wp_users row to attach the ledger.');

    const ledger = new SubscriptionLedgerRepository(dataSource, { tableName: 'stripe_subscriptions' });
    ledger.updateCheckoutReference = async () => ({});
    const accounts = { get: () => billing };
    const deliveriesRepository = new SubscriptionDeliveriesRepository({
      ledgerRepository: ledger,
      productionRepository: new SubscriptionProductionRepository(dataSource),
      stripeAccounts: accounts
    });
    let clockNow = unixAt(START);
    const deliveries = new CustomerDeliveriesService({
      calendar: new DeliveryClosedDaysRepository(dataSource),
      subscriptions: deliveriesRepository,
      ups: deliveriesRepository,
      stripeAccounts: accounts,
      now: () => new Date(clockNow * 1000)
    });
    price = await reusablePrice(stripe);
    // The pack save resolves to this price at 3 packs; the plan preview is fixed so the check needs no catalog.
    const editCommitRepository = new SubscriptionsEditCommitRepository({
      ledgerRepository: ledger,
      stripeBilling: billing,
      planPreviewRepository: {
        previewPlan: async () => ({
          subscription_term_months: 3,
          catalog_pricing: { subtotal: 3 * UNIT_AMOUNT / 100, currency: 'BRL', line_items: [{ pet_id: 'pet_1', pet_name: 'Milo', flavor: 'beef', quantity: 3 }] },
          pets: [{ pet_id: 'pet_1', pet_name: 'Milo' }]
        })
      },
      resolveSubscriptionItems: async () => [{ price: price.id, quantity: 3 }]
    });
    const commitService = new SubscriptionsEditCommitService(editCommitRepository, {
      authService: { assertCriticalOperationAllowed: async () => {} },
      ledgerRepository: ledger,
      deliveryGuard: deliveries
    });

    let currentEvent = null;
    const failures = [];
    const webhooks = new StripeWebhookService({
      stripeBilling: Object.assign(Object.create(billing), { constructEvent: () => currentEvent }),
      webhookSecret: 'whsec_replay',
      ledgerRepository: ledger,
      pendingDeliveryChanges: new PendingDeliveryChangesService({
        ledgerRepository: ledger,
        editCommitRepository,
        now: () => new Date(clockNow * 1000)
      }),
      eventsRepository: {
        insertIfNew: async () => ({ inserted: true }),
        markProcessed: async () => {},
        scheduleRetry: async (row) => { failures.push(row.lastError); },
        markFailed: async (row) => { failures.push(row.lastError); }
      },
      logger: { info() {}, warn() {}, error(payload, message) { failures.push(`${message} ${payload && payload.err ? payload.err.message : ''}`); } }
    });
    const startedAt = Math.floor(Date.now() / 1000) - 60;
    const seen = new Set();
    const subscriptionOf = (event) => (event.type.startsWith('invoice.') ? extractSubscriptionIdFromInvoice(event.data.object) : event.data.object.id);
    const paidCount = {};
    async function replay(done) {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const listed = await stripe.events.list({ types: WATCHED, created: { gte: startedAt }, limit: 100 });
        for (const event of listed.data.filter((item) => !seen.has(item.id) && subscriptionIds.includes(subscriptionOf(item))).reverse()) {
          seen.add(event.id);
          currentEvent = event;
          await webhooks.handle({ account: 'br', rawBody: Buffer.from('{}'), signature: 'replay' });
          if (event.type === 'invoice.paid' && event.data.object.amount_paid > 0) {
            const id = subscriptionOf(event);
            paidCount[id] = (paidCount[id] || 0) + 1;
          }
        }
        if (done()) return true;
        await sleep(4000);
      }
      return false;
    }
    async function advance(step) {
      clockNow = unixAt(step);
      await stripe.testHelpers.testClocks.advance(clock.id, { frozen_time: clockNow });
      clock = await waitForClock(stripe, clock.id);
    }
    const read = async (id) => deliveries.read(await deliveries.loadSubscription(id, userId), userId);
    async function stripeState(id) {
      const subscription = await stripe.subscriptions.retrieve(id);
      const invoices = (await stripe.invoices.list({ subscription: id, limit: 20 })).data.reverse();
      const row = await ledger.findByStripeSubscriptionId(id);
      return {
        status: subscription.status,
        trialEnd: local(subscription.trial_end),
        quantity: subscription.items.data[0].quantity,
        invoices: invoices.map((invoice) => `${invoice.billing_reason} ${invoice.status} ${invoice.amount_paid}`),
        ledgerPending: row && row.pendingDeliveryChanges,
        chargedDeliveries: row && row.chargedDeliveries
      };
    }

    clock = await stripe.testHelpers.testClocks.create({ frozen_time: clockNow, name: CLOCK_NAME });
    const created = {};
    for (const role of ['skip', 'reschedule', 'packs']) {
      const email = `following-${role}-br-clock@example.com`;
      const customer = await stripe.customers.create({ email, test_clock: clock.id, payment_method: 'pm_card_visa', invoice_settings: { default_payment_method: 'pm_card_visa' } });
      const subscription = await stripe.subscriptions.create({ customer: customer.id, items: [{ price: price.id }], metadata: { eden_env: webhooks.edenEnvLabel() } });
      subscriptionIds.push(subscription.id);
      const period = extractSubscriptionPeriod(subscription);
      await ledger.upsert({
        userId,
        customerEmail: email,
        stripeSubscriptionId: subscription.id,
        stripeCustomerId: customer.id,
        stripeAccount: 'br',
        status: 'active',
        currentPeriodStart: period.start,
        currentPeriodEnd: period.end,
        subscriptionTermMonths: 3,
        planSelection: {
          subscription_term_months: 3,
          catalog_pricing: { subtotal: UNIT_AMOUNT / 100, currency: 'BRL', line_items: [{ quantity: 1 }] },
          flavors_by_pet: [{ pet_id: 'pet_1', pet_name: 'Milo', flavors: { beef: 1 } }]
        },
        shipping: { cost: 20, distance: 10 },
        address: { country: 'BR', zipcode: '01310100' }
      });
      created[role] = subscription.id;
    }
    await replay(() => subscriptionIds.every((id) => paidCount[id] >= 1));

    await advance(LOCKED_AT);
    const before = await read(created.skip);
    report.lockedAt = {
      at: local(clockNow),
      current: { date: before.delivery.date, locked: before.delivery.locked },
      actionTarget: before.actionTarget,
      contractEnd: before.contractEnd,
      contractEndIfSkip: before.contractEndIfSkip,
      nextDeliveryIfSkip: before.nextDeliveryIfSkip,
      offeredDates: before.offeredDates.map((offer) => offer.deliveryDate)
    };
    let currentRefused = null;
    try {
      await deliveries.skip(await deliveries.loadSubscription(created.skip, userId), userId, { deliveryId: 'current' });
    } catch (error) {
      currentRefused = error.details && error.details.code;
    }
    report.currentSkipRefused = currentRefused;

    const skipped = await deliveries.skip(await deliveries.loadSubscription(created.skip, userId), userId, { deliveryId: 'following' });
    const moved = await deliveries.reschedule(await deliveries.loadSubscription(created.reschedule, userId), userId, { deliveryId: 'following', date: RESCHEDULE_TO });
    const packsSubscription = await stripe.subscriptions.retrieve(created.packs);
    const packsRow = await ledger.findByStripeSubscriptionId(created.packs);
    const hash = buildCurrentHash({
      items: packsSubscription.items.data.map((item) => ({ price: item.price.id, quantity: item.quantity })),
      termMonths: packsRow.subscriptionTermMonths,
      address: packsRow.address || {},
      shipping: packsRow.shipping || {}
    });
    const packsSaved = await commitService.commit({
      subscriptionId: created.packs,
      userId,
      payload: {
        subscription_term_months: 3,
        delivery_id: 'following',
        expected_current_hash: hash,
        pets: [{ pet_id: 'pet_1', pet_name: 'Milo', enabled: true, selected_flavors: ['beef'], flavor_weights: [3] }]
      }
    });
    report.recorded = {
      skipRead: { later: skipped.later.map((item) => item.deliveryDate), contractEnd: skipped.contractEnd, pendingChange: skipped.pendingChange },
      rescheduleRead: { later: moved.later.map((item) => item.deliveryDate), pendingChange: moved.pendingChange },
      packsResponse: { pending: packsSaved.data.pending_until_current_charge, packs: packsSaved.data.packs_per_month },
      stripeBeforeCharge: {
        skip: await stripeState(created.skip),
        reschedule: await stripeState(created.reschedule),
        packs: await stripeState(created.packs)
      }
    };

    await advance(AFTER_CHARGE);
    await replay(() => subscriptionIds.every((id) => paidCount[id] >= 2));
    await replay(() => true);
    const skipState = await stripeState(created.skip);
    const moveState = await stripeState(created.reschedule);
    const packsState = await stripeState(created.packs);
    report.afterCurrentCharge = {
      at: local(clockNow),
      skip: { ...skipState, expectedTrialEnd: local(unixAt(EXPECTED_SKIP)) },
      reschedule: { ...moveState, expectedTrialEnd: local(unixAt(RESCHEDULE_TO.split('-').map(Number))) },
      packs: packsState
    };
    report.checks = {
      currentRefused: currentRefused === 'delivery_locked',
      stripeUntouchedBeforeCharge: ['skip', 'reschedule', 'packs'].every((role) => report.recorded.stripeBeforeCharge[role].trialEnd == null)
        && report.recorded.stripeBeforeCharge.packs.quantity === 1,
      currentChargedAtOldQuantity: [skipState, moveState, packsState].every((state) => state.invoices.filter((line) => line.startsWith('subscription_cycle paid')).length === 1)
        && packsState.invoices.some((line) => line === `subscription_cycle paid ${UNIT_AMOUNT}`),
      skipTrialEnd: (await stripe.subscriptions.retrieve(created.skip)).trial_end === unixAt(EXPECTED_SKIP),
      rescheduleTrialEnd: (await stripe.subscriptions.retrieve(created.reschedule)).trial_end === unixAt(RESCHEDULE_TO.split('-').map(Number)),
      packsQuantity: packsState.quantity === 3,
      pendingCleared: [skipState, moveState, packsState].every((state) => state.ledgerPending == null)
    };
    report.webhookFailures = failures;
  } catch (error) {
    report.error = error.stack || error.message;
  } finally {
    for (const id of subscriptionIds) {
      await dataSource.query('DELETE FROM stripe_subscriptions WHERE stripe_subscription_id = ?', [id]).catch(() => {});
    }
    if (clock) await stripe.testHelpers.testClocks.del(clock.id).catch((error) => { report.cleanupError = error.message; });
    await dataSource.destroy();
  }
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
