require('dotenv').config();

const { DateTime } = require('luxon');
const { parseEnv } = require('../config/env');
const { createDataSource } = require('../infrastructure/db');
const { StripeBillingClient } = require('../infrastructure/stripe/stripe-billing-client');
const { SubscriptionLedgerRepository } = require('../infrastructure/repositories/subscription-ledger.repository');
const { SubscriptionProductionRepository } = require('../infrastructure/repositories/subscription-production.repository');
const { SubscriptionDeliveriesRepository } = require('../infrastructure/repositories/subscription-deliveries.repository');
const { DeliveryClosedDaysRepository } = require('../infrastructure/repositories/delivery-closed-days.repository');
const { StripeWebhookService } = require('../services/stripe-webhook.service');
const { CustomerDeliveriesService } = require('../services/customer-deliveries.service');
const { stripeChargedInvoiceCount } = require('../core/contract-deliveries');
const { extractSubscriptionIdFromInvoice, extractSubscriptionPeriod } = require('../core/stripe-subscription-map');
const { TIMEZONE_BR, TIMEZONE_US, wallTimeToUtc } = require('../core/delivery-closed-days');

const API_VERSION = '2025-09-30.clover';
const CLOCK_NAME = 'redesign-my-plan-skip-reschedule';
const CHECK_KEY = 'redesign-my-plan-clock';
const WATCHED_EVENTS = [
  'invoice.created',
  'invoice.paid',
  'invoice.payment_failed',
  'customer.subscription.updated',
  'customer.subscription.trial_will_end'
];

// Brazil: charge Monday 7 Dec 2026 14:00, delivered Tuesday 8 Dec. The following charge (7 Jan 14:00)
// prepares on Friday 8 Jan. United States: charge Monday 14 Dec 2026 00:00, delivered Wednesday 16 Dec.
// The following charge is Thursday 14 Jan 2027 00:00; with 1 transit day Thursday and Friday cannot ship.
// Each check runs 2 hours after the charge moment because Stripe finalizes a subscription invoice about
// an hour after creating it.
const MARKETS = [
  {
    market: 'BR',
    account: 'br',
    secretName: 'STRIPE_BR_SECRET_KEY',
    zone: TIMEZONE_BR,
    currency: 'brl',
    unitAmount: 18990,
    start: [2026, 11, 7, 14, 0],
    address: { country: 'BR', zipcode: '01310100' },
    shipping: { cost: 20, distance: 10 },
    expectedSkip: [2027, 1, 8],
    rescheduleTo: '2026-12-15',
    steps: [[2026, 12, 7, 16, 0], [2026, 12, 15, 2, 0], [2027, 1, 8, 2, 0]]
  },
  {
    market: 'US',
    account: 'us',
    secretName: 'STRIPE_US_SECRET_KEY',
    zone: TIMEZONE_US,
    currency: 'usd',
    unitAmount: 9600,
    start: [2026, 11, 14, 0, 0],
    address: { country: 'US', postal_code: '10001', business_days_in_transit: 1 },
    shipping: { cost: 12.9, delivery_days: 1 },
    expectedSkip: [2027, 1, 18],
    rescheduleTo: '2026-12-24',
    steps: [[2026, 12, 14, 2, 0], [2026, 12, 22, 2, 0], [2027, 1, 18, 2, 0]]
  }
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function unixAt(zone, [year, month, day, hour = 0, minute = 0]) {
  return Math.floor(wallTimeToUtc(year, month, day, hour, minute, 0, zone).getTime() / 1000);
}

function local(zone, unix) {
  if (typeof unix !== 'number') return unix == null ? null : String(unix);
  return DateTime.fromSeconds(unix, { zone }).toFormat('yyyy-LL-dd HH:mm ccc ZZZZ');
}

async function waitForClock(stripe, clockId) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const clock = await stripe.testHelpers.testClocks.retrieve(clockId);
    if (clock.status === 'ready') return clock;
    await sleep(3000);
  }
  throw new Error(`Test clock ${clockId} did not become ready.`);
}

function invoiceSummary(invoice) {
  return {
    billing_reason: invoice.billing_reason,
    status: invoice.status,
    subtotal: invoice.subtotal,
    amount_paid: invoice.amount_paid
  };
}

function mailRecorder(mails) {
  return new Proxy({}, {
    get(_target, name) {
      if (name === 'then') return undefined;
      if (name === 'hasSentClaim') return async () => false;
      return async (payload = {}) => {
        mails.push({ template: String(name), subscriptionId: payload.subscriptionId || null });
        return { claimed: true };
      };
    }
  });
}

async function reusableProduct(stripe) {
  for (const active of [true, false]) {
    const listed = await stripe.products.list({ active, limit: 100 });
    const found = listed.data.find((item) => item.metadata && item.metadata.eden_check === CHECK_KEY);
    if (found) {
      return active ? found : stripe.products.update(found.id, { active: true });
    }
  }
  return stripe.products.create({ name: 'My Plan skip and postpone check', metadata: { eden_check: CHECK_KEY } });
}

async function reusablePrice(stripe, product, config) {
  const lookupKey = `${CHECK_KEY}-${config.currency}-${config.unitAmount}`;
  const listed = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1 });
  if (listed.data[0]) {
    return listed.data[0].active ? listed.data[0] : stripe.prices.update(listed.data[0].id, { active: true });
  }
  return stripe.prices.create({
    product: product.id,
    currency: config.currency,
    unit_amount: config.unitAmount,
    recurring: { interval: 'month' },
    lookup_key: lookupKey,
    transfer_lookup_key: true
  });
}

async function inspectWebhookEndpoints(stripe) {
  const listed = await stripe.webhookEndpoints.list({ limit: 100 });
  return listed.data.map((endpoint) => {
    let where = '';
    try {
      const url = new URL(endpoint.url);
      where = `${url.hostname}${url.pathname}`;
    } catch (_error) {
      where = 'unparsed';
    }
    const events = endpoint.enabled_events || [];
    return {
      endpoint: where,
      status: endpoint.status,
      listensToAll: events.includes('*'),
      trialWillEnd: events.includes('*') || events.includes('customer.subscription.trial_will_end'),
      eventCount: events.length
    };
  });
}

async function runMarket(env, config, dataSource, userId) {
  const secret = env[config.secretName];
  if (!secret || !secret.startsWith('sk_test_')) {
    return { skipped: `${config.secretName} is not a test key.` };
  }
  const stripe = require('stripe')(secret, { apiVersion: API_VERSION });
  const billing = new StripeBillingClient({ account: config.account, secretKey: secret, apiVersion: API_VERSION });
  const report = { webhookEndpoints: await inspectWebhookEndpoints(stripe) };

  const calendar = new DeliveryClosedDaysRepository(dataSource);
  const ledger = new SubscriptionLedgerRepository(dataSource, { tableName: 'stripe_subscriptions' });
  // The check must not touch the test user's onboarding checkout state.
  ledger.updateCheckoutReference = async () => ({});
  const production = new SubscriptionProductionRepository(dataSource);
  const accounts = { get: () => billing };
  const deliveries = new SubscriptionDeliveriesRepository({
    ledgerRepository: ledger,
    productionRepository: production,
    stripeAccounts: accounts,
    logger: { warn() {}, error(payload, message) { report.readErrors = [...(report.readErrors || []), message]; } }
  });
  let clockNow = unixAt(config.zone, config.start);
  const service = new CustomerDeliveriesService({
    calendar,
    subscriptions: deliveries,
    ups: deliveries,
    stripeAccounts: accounts,
    now: () => new Date(clockNow * 1000)
  });

  const mails = [];
  const webhookLog = { failures: [], warnings: [], ignored: [], dispatched: [] };
  let currentEvent = null;
  const replayBilling = Object.assign(Object.create(billing), { constructEvent: () => currentEvent });
  const webhooks = new StripeWebhookService({
    stripeBilling: replayBilling,
    webhookSecret: 'whsec_replay',
    ledgerRepository: ledger,
    transactionalMailer: mailRecorder(mails),
    eventsRepository: {
      insertIfNew: async () => ({ inserted: true }),
      markProcessed: async () => {},
      scheduleRetry: async (row) => { webhookLog.failures.push(row.lastError); },
      markFailed: async (row) => { webhookLog.failures.push(row.lastError); }
    },
    logger: {
      info() {},
      warn(payload, message) { webhookLog.warnings.push({ message, reason: payload && payload.reason }); },
      error(payload, message) { webhookLog.failures.push(`${message} ${payload && payload.err ? payload.err.message : ''}`.trim()); }
    }
  });

  const startedAt = Math.floor(Date.now() / 1000) - 60;
  const seen = new Set();
  const subscriptionIds = [];
  const events = [];

  function subscriptionOf(event) {
    const object = event.data.object;
    return event.type.startsWith('invoice.') ? extractSubscriptionIdFromInvoice(object) : object.id;
  }

  async function replayEvents(done, label) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const listed = await stripe.events.list({ types: WATCHED_EVENTS, created: { gte: startedAt }, limit: 100 });
      const fresh = listed.data
        .filter((event) => !seen.has(event.id) && subscriptionIds.includes(subscriptionOf(event)))
        .reverse();
      for (const event of fresh) {
        seen.add(event.id);
        events.push(event);
        currentEvent = event;
        const handled = WATCHED_EVENTS.includes(event.type) && event.type !== 'customer.subscription.trial_will_end';
        await webhooks.handle({ account: config.account, rawBody: Buffer.from('{}'), signature: 'replay' });
        (handled ? webhookLog.dispatched : webhookLog.ignored).push({ type: event.type, label });
      }
      if (done(events)) return true;
      await sleep(4000);
    }
    return false;
  }

  async function advance(step) {
    clockNow = unixAt(config.zone, step);
    clock = await stripe.testHelpers.testClocks.advance(clock.id, { frozen_time: clockNow });
    clock = await waitForClock(stripe, clock.id);
  }

  async function stripeState(subscriptionId) {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const invoices = (await stripe.invoices.list({ subscription: subscriptionId, limit: 20 })).data;
    const paid = await billing.listPaidInvoicesForSubscription(subscriptionId);
    const row = await ledger.findByStripeSubscriptionId(subscriptionId);
    return {
      stripeStatus: subscription.status,
      trialEnd: local(config.zone, subscription.trial_end),
      invoices: invoices.map(invoiceSummary).reverse(),
      chargedInvoices: invoices.filter((invoice) => invoice.status === 'paid' && invoice.amount_paid > 0).length,
      chargedDeliveries: { ledger: row && row.chargedDeliveries, stripeRule: stripeChargedInvoiceCount(paid) },
      ledgerStatus: row && row.status
    };
  }

  async function readFor(subscriptionId) {
    const read = await service.read(await service.loadSubscription(subscriptionId, userId), userId);
    return {
      delivery: read.delivery && read.delivery.date,
      later: read.later.map((item) => item.deliveryDate),
      contractEnd: read.contractEnd,
      contractEndIfSkip: read.contractEndIfSkip
    };
  }

  function paidAbove(subscriptionId, count) {
    return (list) => list.filter((event) => event.type === 'invoice.paid'
      && subscriptionOf(event) === subscriptionId
      && event.data.object.amount_paid > 0).length >= count;
  }

  let clock;
  let product;
  let price;
  try {
    clock = await stripe.testHelpers.testClocks.create({ frozen_time: clockNow, name: CLOCK_NAME });
    product = await reusableProduct(stripe);
    price = await reusablePrice(stripe, product, config);

    const created = {};
    for (const role of ['skip', 'reschedule']) {
      const email = `${role}-${config.account}-clock@example.com`;
      const customer = await stripe.customers.create({
        email,
        test_clock: clock.id,
        payment_method: 'pm_card_visa',
        invoice_settings: { default_payment_method: 'pm_card_visa' }
      });
      const subscription = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: price.id }],
        metadata: { eden_env: webhooks.edenEnvLabel() }
      });
      subscriptionIds.push(subscription.id);
      const period = extractSubscriptionPeriod(subscription);
      await ledger.upsert({
        userId,
        customerEmail: email,
        stripeSubscriptionId: subscription.id,
        stripeCustomerId: customer.id,
        stripeAccount: config.account,
        status: 'active',
        currentPeriodStart: period.start,
        currentPeriodEnd: period.end,
        subscriptionTermMonths: 3,
        planSelection: {
          subscription_term_months: 3,
          catalog_pricing: {
            subtotal: config.unitAmount / 100,
            currency: config.currency.toUpperCase(),
            line_items: [{ quantity: 4 }]
          }
        },
        shipping: config.shipping,
        address: config.address
      });
      created[role] = { id: subscription.id, customer: customer.id, email, chargeAt: local(config.zone, period.end) };
    }
    await replayEvents((list) => subscriptionIds.every((id) => paidAbove(id, 1)(list)), 'first charge');
    report.created = Object.fromEntries(Object.entries(created).map(([role, item]) => [role, { chargeAt: item.chargeAt }]));

    const skipId = created.skip.id;
    const moveId = created.reschedule.id;
    const beforeSkip = await readFor(skipId);
    const skipped = await service.skip(await service.loadSubscription(skipId, userId), userId, { deliveryId: 'current' });
    const expectedSkip = unixAt(config.zone, config.expectedSkip);

    const beforeMove = await service.read(await service.loadSubscription(moveId, userId), userId);
    const offer = beforeMove.offeredDates.find((item) => item.deliveryDate === config.rescheduleTo);
    const moved = offer
      ? await service.reschedule(await service.loadSubscription(moveId, userId), userId, { deliveryId: 'current', date: offer.deliveryDate })
      : null;

    await replayEvents((list) => subscriptionIds.every((id) => list.some((event) => (
      event.type === 'customer.subscription.updated' && event.data.object.id === id && event.data.object.status === 'trialing'
    ))), 'after confirm');

    const skipState = await stripeState(skipId);
    report.skip = {
      before: beforeSkip,
      sentTrialEnd: local(config.zone, (await stripe.subscriptions.retrieve(skipId)).trial_end),
      expectedTrialEnd: local(config.zone, expectedSkip),
      trialEndMatches: (await stripe.subscriptions.retrieve(skipId)).trial_end === expectedSkip,
      readAfterSkip: { delivery: skipped.delivery.date, later: skipped.later.map((item) => item.deliveryDate), contractEnd: skipped.contractEnd },
      contractEndMatchesNotice: skipped.contractEnd === beforeSkip.contractEndIfSkip,
      atConfirm: skipState
    };
    report.reschedule = {
      currentDelivery: beforeMove.delivery.date,
      offeredDates: beforeMove.offeredDates.map((item) => `${item.deliveryDate} (prep ${item.preparationDay}, end ${item.contractEnd})`),
      chosen: offer || `missing ${config.rescheduleTo}`,
      sentTrialEnd: local(config.zone, (await stripe.subscriptions.retrieve(moveId)).trial_end),
      expectedTrialEnd: offer ? local(config.zone, unixAt(config.zone, offer.preparationDay.split('-').map(Number))) : null,
      trialEndMatches: offer
        ? (await stripe.subscriptions.retrieve(moveId)).trial_end === unixAt(config.zone, offer.preparationDay.split('-').map(Number))
        : false,
      readAfterConfirm: moved ? moved.delivery.date : null,
      contractEndMatchesOffer: moved ? moved.contractEnd === offer.contractEnd : false,
      atConfirm: await stripeState(moveId)
    };

    await advance(config.steps[0]);
    await replayEvents(() => true, 'original charge passed');
    report.afterOriginalCharge = {
      at: local(config.zone, clockNow),
      skip: await stripeState(skipId),
      reschedule: await stripeState(moveId),
      rescheduleRead: await readFor(moveId),
      skipRead: await readFor(skipId)
    };

    await advance(config.steps[1]);
    await replayEvents(paidAbove(moveId, 2), 'postponed charge');
    report.reschedule.atNewCharge = { at: local(config.zone, clockNow), ...(await stripeState(moveId)) };
    report.skip.stillWaiting = { at: local(config.zone, clockNow), ...(await stripeState(skipId)) };

    await advance(config.steps[2]);
    await replayEvents(paidAbove(skipId, 2), 'skipped charge');
    report.skip.atTrialEnd = { at: local(config.zone, clockNow), ...(await stripeState(skipId)) };

    report.trialWillEnd = events
      .filter((event) => event.type === 'customer.subscription.trial_will_end')
      .map((event) => ({ subscription: event.data.object.id === skipId ? 'skip' : 'reschedule' }));
    report.mails = mails.map((mail) => ({
      template: mail.template,
      subscription: mail.subscriptionId === skipId ? 'skip' : mail.subscriptionId === moveId ? 'reschedule' : mail.subscriptionId
    }));
    report.webhooks = {
      dispatched: webhookLog.dispatched.map((item) => `${item.label}: ${item.type}`),
      ignored: webhookLog.ignored.map((item) => `${item.label}: ${item.type}`),
      warnings: webhookLog.warnings,
      failures: webhookLog.failures
    };
    return report;
  } catch (error) {
    report.error = error.message;
    return report;
  } finally {
    for (const id of subscriptionIds) {
      await dataSource.query('DELETE FROM stripe_subscriptions WHERE stripe_subscription_id = ?', [id]).catch(() => {});
    }
    const left = { ledgerRows: 0, clocks: 0, customers: 0 };
    if (subscriptionIds.length) {
      const rows = await dataSource.query(
        `SELECT COUNT(*) AS total FROM stripe_subscriptions WHERE stripe_subscription_id IN (${subscriptionIds.map(() => '?').join(',')})`,
        subscriptionIds
      );
      left.ledgerRows = Number(rows[0] && rows[0].total) || 0;
    }
    if (clock) {
      await stripe.testHelpers.testClocks.del(clock.id).catch((error) => { report.cleanupError = error.message; });
      const clocks = await stripe.testHelpers.testClocks.list({ limit: 100 });
      left.clocks = clocks.data.filter((item) => item.name === CLOCK_NAME).length;
      for (const role of ['skip', 'reschedule']) {
        const found = await stripe.customers.list({ email: `${role}-${config.account}-clock@example.com`, limit: 10 });
        left.customers += found.data.length;
      }
    }
    if (price) await stripe.prices.update(price.id, { active: false }).catch(() => {});
    if (product) await stripe.products.update(product.id, { active: false }).catch(() => {});
    report.leftover = left;
  }
}

async function main() {
  const env = parseEnv();
  if (!String(process.env.EDEN_RUNTIME || '').trim()) {
    process.env.EDEN_RUNTIME = 'sandbox-skip-check';
  }
  const only = String(process.argv[2] || '').toUpperCase();
  const dataSource = createDataSource(env);
  await dataSource.initialize();
  try {
    const users = await dataSource.query('SELECT ID AS id FROM wp_users ORDER BY ID ASC LIMIT 1');
    const userId = users[0] && users[0].id;
    if (!userId) throw new Error('No wp_users row to attach the ledger.');
    const result = {};
    for (const config of MARKETS) {
      if (only && only !== config.market) continue;
      result[config.market] = await runMarket(env, config, dataSource, userId);
    }
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
