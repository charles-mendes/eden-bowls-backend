const { planNoticeFor, planNoticePayload, planNoticeReference } = require('../src/core/plan-notice');

const now = new Date('2026-11-02T12:00:00.000Z');
const inDays = (days) => new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
const row = (changes = {}) => ({
  status: 'active',
  autoRenew: true,
  cancelAtPeriodEnd: false,
  subscriptionTermMonths: 1,
  chargedDeliveries: 2,
  currentPeriodEnd: inDays(7),
  ...changes
});
const notice = (changes) => planNoticeFor(row(changes), { now, noticeDays: 7 });

describe('planNoticeFor', () => {
  test('One-month plan', () => {
    expect(notice()).toMatchObject({ kind: 'renewal', emailable: true, daysLeft: 7 });
  });

  test('Last paid delivery of a three-month contract', () => {
    expect(notice({ subscriptionTermMonths: 3, chargedDeliveries: 3 })).toMatchObject({ kind: 'renewal' });
    expect(notice({ subscriptionTermMonths: 3, chargedDeliveries: 6 })).toMatchObject({ kind: 'renewal' });
  });

  test('reads the term from the plan when the column is empty', () => {
    expect(notice({ subscriptionTermMonths: null, planSelection: { subscription_term_months: 3 }, chargedDeliveries: 1 })).toBeNull();
  });

  test('Charge inside a contract', () => {
    expect(notice({ subscriptionTermMonths: 3, chargedDeliveries: 1 })).toBeNull();
  });

  test('One-month plan without a stored count', () => {
    expect(notice({ chargedDeliveries: null })).toMatchObject({ kind: 'renewal' });
  });

  test('One-month plan with nothing charged', () => {
    expect(notice({ chargedDeliveries: 0 })).toBeNull();
  });

  test('Charged deliveries unknown on a longer term', () => {
    expect(notice({ subscriptionTermMonths: 3, chargedDeliveries: null })).toBeNull();
  });

  test.each(['past_due', 'paused', 'canceled'])('Subscription not in good standing: %s', (status) => {
    expect(notice({ status })).toBeNull();
  });

  test('Period end already passed', () => {
    expect(notice({ currentPeriodEnd: inDays(-1) })).toBeNull();
    expect(notice({ currentPeriodEnd: inDays(-1), cancelAtPeriodEnd: true, autoRenew: false })).toBeNull();
  });

  test('Outside the window', () => {
    expect(notice({ currentPeriodEnd: inDays(7.01) })).toBeNull();
  });

  test('days_left is never negative and rounds up to whole days', () => {
    expect(notice({ currentPeriodEnd: now }).daysLeft).toBe(0);
    expect(notice({ currentPeriodEnd: inDays(0.5) }).daysLeft).toBe(1);
  });

  test('Renewal off after the last charge', () => {
    expect(notice({ autoRenew: false, cancelAtPeriodEnd: true })).toMatchObject({ kind: 'ending', emailable: true });
  });

  test('Renewal off with deliveries still to charge', () => {
    expect(notice({ autoRenew: false, cancelAtPeriodEnd: false })).toBeNull();
  });

  test.each([[true], [null]])('Explicit cancellation with stored auto_renew %s keeps the banner, not the email', (autoRenew) => {
    expect(notice({ autoRenew, cancelAtPeriodEnd: true })).toMatchObject({ kind: 'ending', emailable: false });
  });

  test('an ending plan that is past due shows the banner and is not emailed', () => {
    expect(notice({ status: 'past_due', autoRenew: false, cancelAtPeriodEnd: true })).toMatchObject({ kind: 'ending', emailable: false });
  });

  test('a canceled plan shows nothing', () => {
    expect(notice({ status: 'canceled', autoRenew: false, cancelAtPeriodEnd: true })).toBeNull();
  });

  test('reads a stored period end as UTC', () => {
    expect(notice({ currentPeriodEnd: '2026-11-09 12:00:00' }).date.toISOString()).toBe('2026-11-09T12:00:00.000Z');
  });
});

test('the reference changes with the period end and the payload keeps the exact instant', () => {
  const first = notice();
  expect(planNoticeReference(first)).toBe(`renewal_notice:${Math.floor(inDays(7).getTime() / 1000)}`);
  expect(planNoticeReference(notice({ currentPeriodEnd: inDays(6) }))).not.toBe(planNoticeReference(first));
  expect(planNoticeReference(notice({ autoRenew: false, cancelAtPeriodEnd: true }))).toMatch(/^plan_ending_notice:/);
  expect(planNoticePayload(first)).toEqual({ kind: 'renewal', date: '2026-11-09T12:00:00.000Z', days_left: 7 });
  expect(planNoticePayload(null)).toBeNull();
});
