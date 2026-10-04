require('dotenv').config();

const { DateTime } = require('luxon');
const { parseEnv } = require('../config/env');
const { createDataSource } = require('../infrastructure/db');
const { StripeBillingClient } = require('../infrastructure/stripe/stripe-billing-client');
const { SubscriptionLedgerRepository } = require('../infrastructure/repositories/subscription-ledger.repository');
const { DeliveryClosedDaysRepository } = require('../infrastructure/repositories/delivery-closed-days.repository');
const { StripeWebhookService } = require('../services/stripe-webhook.service');
const { CustomerDeliveriesService } = require('../services/customer-deliveries.service');
const {
  TIMEZONE_BR,
  firstPrepDay,
  wallTimeToUtc
} = require('../core/delivery-closed-days');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function saoPaulo(year, month, day, hour) {
  return Math.floor(wallTimeToUtc(year, month, day, hour, 0, 0, TIMEZONE_BR).getTime() / 1000);
}

function formatSaoPaulo(unix) {
  if (typeof unix !== 'number') return String(unix);
  return DateTime.fromSeconds(unix, { zone: TIMEZONE_BR }).toFormat('yyyy-LL-dd HH:mm:ss ZZZZ');
}

async function waitForClock(stripe, clockId) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const clock = await stripe.testHelpers.testClocks.retrieve(clockId);
    if (clock.status === 'ready') return clock;
    await sleep(3000);
  }
  throw new Error(`Test clock ${clockId} did not become ready.`);
}

async function main() {
  const env = parseEnv();
  const secret = env.STRIPE_BR_SECRET_KEY;
  if (!secret || !secret.startsWith('sk_test_')) {
    throw new Error('STRIPE_BR_SECRET_KEY must be a test key.');
  }
  const marker = env.EDEN_RUNTIME || 'sandbox-block-check';
  process.env.EDEN_RUNTIME = marker;

  const stripe = require('stripe')(secret, { apiVersion: '2025-09-30.clover' });
  const billing = new StripeBillingClient({
    account: 'br',
    secretKey: secret,
    apiVersion: '2025-09-30.clover'
  });
  const dataSource = createDataSource(env);
  await dataSource.initialize();
  const calendar = new DeliveryClosedDaysRepository(dataSource);
  const ledger = new SubscriptionLedgerRepository(dataSource, {
    tableName: 'stripe_subscriptions'
  });
  const warnings = [];
  const webhooks = new StripeWebhookService({
    ledgerRepository: ledger,
    logger: {
      error() {},
      info() {},
      warn(payload, message) { warnings.push({ message, reason: payload && payload.reason }); }
    }
  });
  const rows = await calendar.listActive();
  const users = await dataSource.query('SELECT ID AS id FROM wp_users ORDER BY ID ASC LIMIT 1');
  const userId = users[0] && users[0].id;
  if (!userId) throw new Error('No wp_users row to attach the ledger.');

  const frozen = saoPaulo(2026, 6, 5, 10);
  const followingCharge = wallTimeToUtc(2026, 6, 6, 14, 0, 0, TIMEZONE_BR);
  const expectedPrep = firstPrepDay('BR', followingCharge, rows, 0);
  const expectedTrialEnd = Math.floor(wallTimeToUtc(
    expectedPrep.year,
    expectedPrep.month,
    expectedPrep.day,
    0,
    0,
    0,
    TIMEZONE_BR
  ).getTime() / 1000);
  const originalPrep = expectedTrialEnd;
  const afterOriginal = saoPaulo(2026, 6, 9, 12);

  let clock;
  let product;
  const subscriptionIds = [];
  const report = {};

  try {
    clock = await stripe.testHelpers.testClocks.create({
      frozen_time: frozen,
      name: 'redesign-my-plan-block'
    });
    const customer = await stripe.customers.create({
      email: 'block-clock@example.com',
      test_clock: clock.id,
      payment_method: 'pm_card_visa',
      invoice_settings: { default_payment_method: 'pm_card_visa' }
    });
    product = await stripe.products.create({ name: 'Block clock check' });
    const price = await stripe.prices.create({
      product: product.id,
      currency: 'brl',
      unit_amount: 1000,
      recurring: { interval: 'month' }
    });
    const service = new CustomerDeliveriesService({
      calendar,
      stripeAccounts: { get: () => billing },
      now: () => new Date(frozen * 1000)
    });

    const created = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: price.id }],
      trial_end: saoPaulo(2026, 6, 20, 0),
      proration_behavior: 'none',
      metadata: { eden_env: marker }
    });
    subscriptionIds.push(created.id);
    const invoicesBefore = await stripe.invoices.list({ subscription: created.id, limit: 10 });

    await service.onProductionStatus({
      subscription: {
        market: 'BR',
        chargeAt: wallTimeToUtc(2026, 5, 6, 14, 0, 0, TIMEZONE_BR),
        transitDays: 0,
        stripeSubscriptionId: created.id,
        originalPreparationDay: null
      },
      toStatus: 'blocked',
      fromStatus: 'to_prepare',
      alreadyCharged: false
    });

    const blocked = await stripe.subscriptions.retrieve(created.id);
    const invoicesAfterBlock = await stripe.invoices.list({ subscription: created.id, limit: 10 });
    report.block = {
      trialEnd: formatSaoPaulo(blocked.trial_end),
      expected: formatSaoPaulo(expectedTrialEnd),
      matchesMidnight: blocked.trial_end === expectedTrialEnd,
      prorationSent: 'none',
      newInvoices: invoicesAfterBlock.data.length - invoicesBefore.data.length
    };

    clock = await stripe.testHelpers.testClocks.advance(clock.id, { frozen_time: expectedTrialEnd });
    clock = await waitForClock(stripe, clock.id);
    const charged = await stripe.subscriptions.retrieve(created.id);
    const paid = await stripe.invoices.list({ subscription: created.id, status: 'paid', limit: 10 });
    const paidInvoice = paid.data.find((item) => item.amount_paid > 0) || paid.data[0];
    if (paidInvoice) {
      await ledger.upsert({
        userId,
        stripeSubscriptionId: created.id,
        stripeCustomerId: customer.id,
        stripeAccount: 'br',
        status: 'trialing',
        customerEmail: 'block-clock@example.com'
      });
      const details = paidInvoice.subscription_details || {};
      paidInvoice.subscription_details = {
        ...details,
        metadata: { ...(details.metadata || {}), eden_env: marker }
      };
      await webhooks.handleInvoicePaid(paidInvoice, {
        account: 'br',
        stripeBilling: billing
      }, { id: 'evt_clock_paid', type: 'invoice.paid' });
    }
    const ledgerRow = await ledger.findByStripeSubscriptionId(created.id);
    report.chargeAtTrialEnd = {
      status: charged.status,
      trialEnd: formatSaoPaulo(charged.trial_end),
      paidInvoices: paid.data.length,
      ledgerStatus: ledgerRow && ledgerRow.status,
      webhookWarnings: warnings
    };

    const lateSub = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: price.id }],
      trial_end: saoPaulo(2026, 6, 20, 0),
      proration_behavior: 'none',
      metadata: { eden_env: marker }
    });
    subscriptionIds.push(lateSub.id);
    clock = await stripe.testHelpers.testClocks.advance(clock.id, { frozen_time: afterOriginal });
    clock = await waitForClock(stripe, clock.id);
    const beforeLate = (await stripe.invoices.list({ subscription: lateSub.id, limit: 10 })).data.length;
    const lateService = new CustomerDeliveriesService({
      calendar,
      stripeAccounts: { get: () => billing },
      now: () => new Date(afterOriginal * 1000)
    });
    const latePlan = await lateService.onProductionStatus({
      subscription: {
        market: 'BR',
        chargeAt: followingCharge,
        transitDays: 0,
        stripeSubscriptionId: lateSub.id,
        originalPreparationDay: `${expectedPrep.year}-${String(expectedPrep.month).padStart(2, '0')}-${String(expectedPrep.day).padStart(2, '0')}`
      },
      toStatus: 'to_prepare',
      fromStatus: 'blocked',
      alreadyCharged: false
    });
    const late = await stripe.subscriptions.retrieve(lateSub.id);
    const afterLate = (await stripe.invoices.list({ subscription: lateSub.id, limit: 10 })).data.length;
    report.lateUnblock = {
      sentTrialEnd: latePlan.stripeUpdate && latePlan.stripeUpdate.trial_end,
      subscriptionStatus: late.status,
      trialEnd: formatSaoPaulo(late.trial_end),
      trialEndIsPast: typeof late.trial_end === 'number' && late.trial_end < originalPrep,
      newInvoices: afterLate - beforeLate
    };
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (dataSource && subscriptionIds.length) {
      for (const id of subscriptionIds) {
        await dataSource.query(
          'DELETE FROM stripe_subscriptions WHERE stripe_subscription_id = ?',
          [id]
        ).catch(() => {});
      }
    }
    if (clock) {
      await stripe.testHelpers.testClocks.del(clock.id).catch((error) => {
        console.error('clock delete failed', error.message);
      });
      const leftover = await stripe.testHelpers.testClocks.list({ limit: 20 });
      const stillThere = leftover.data.filter((item) => item.id === clock.id || item.name === 'redesign-my-plan-block');
      console.log(JSON.stringify({ leftoverClocks: stillThere.length }));
    }
    if (product) {
      await stripe.products.update(product.id, { active: false }).catch(() => {});
    }
    if (dataSource) await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
