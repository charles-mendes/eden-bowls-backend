const { NOTICE_KINDS, PLAN_NOTICE_TEMPLATES, planNoticeFor, planNoticeReference } = require('../core/plan-notice');

const PLAN_NOTICES_PER_TICK = 100;
const DAY_MS = 24 * 60 * 60 * 1000;
const ACCOUNTS = { BR: 'br', US: 'us' };

function periodEndTime(row) {
  return new Date(row.currentPeriodEnd).getTime();
}

// Hourly renewal and plan-ending notices (plan-notices). The claim is the only state: a repeat tick finds it and
// moves on without calling Stripe or using the limit. A failed send releases it, so the next tick tries again
// while the subscription still qualifies.
class PlanNoticesService {
  constructor({ ledgerRepository, claimsRepository, settings, mailer, billingFor, logger, now, perTick } = {}) {
    this.ledgerRepository = ledgerRepository;
    this.claimsRepository = claimsRepository;
    this.settings = settings;
    this.mailer = mailer;
    this.billingFor = billingFor;
    this.logger = logger || { warn() {}, error() {} };
    this.now = now || (() => new Date());
    this.perTick = perTick || PLAN_NOTICES_PER_TICK;
  }

  async candidates(now) {
    const items = [];
    for (const [market, account] of Object.entries(ACCOUNTS)) {
      const settings = await this.settings.forMarket(market);
      if (!settings.renewalNoticeEnabled && !settings.planEndingNoticeEnabled) continue;
      const until = new Date(now.getTime() + settings.planNoticeDays * DAY_MS);
      const rows = await this.ledgerRepository.listPlanNoticeCandidates(account, now, until);
      for (const row of rows) items.push({ row, settings, account });
    }
    return items.sort((a, b) => periodEndTime(a.row) - periodEndTime(b.row));
  }

  // A failed preview costs the letter its amount, never the letter.
  async nextInvoiceTotal(row, account) {
    try {
      return await this.billingFor(account).previewUpcomingInvoice(row.stripeSubscriptionId);
    } catch (error) {
      this.logger.warn({ subscriptionId: row.stripeSubscriptionId, code: error && error.code }, 'Renewal notice goes out without an amount.');
      return null;
    }
  }

  async send(notice, { row, account }) {
    const subscriptionId = row.stripeSubscriptionId;
    const referenceId = planNoticeReference(notice);
    if (await this.claimsRepository.hasClaim({ subscriptionId, template: PLAN_NOTICE_TEMPLATES[notice.kind], referenceId })) {
      return { skipped: true };
    }
    if (notice.kind === NOTICE_KINDS.renewal) {
      const total = await this.nextInvoiceTotal(row, account);
      return this.mailer.notifyRenewalNotice({ ledger: row, subscriptionId, referenceId, renewsOn: notice.date, total });
    }
    return this.mailer.notifyPlanEndingNotice({ ledger: row, subscriptionId, referenceId, endsOn: notice.date });
  }

  enabled(notice, settings) {
    return notice.kind === NOTICE_KINDS.renewal ? settings.renewalNoticeEnabled : settings.planEndingNoticeEnabled;
  }

  async runDue() {
    const now = this.now();
    const summary = { scanned: 0, sent: 0, skipped: 0, failed: 0 };
    for (const item of await this.candidates(now)) {
      if (summary.sent >= this.perTick) break;
      summary.scanned += 1;
      const notice = planNoticeFor(item.row, { now, noticeDays: item.settings.planNoticeDays });
      if (!notice || !notice.emailable || !this.enabled(notice, item.settings)) {
        summary.skipped += 1;
        continue;
      }
      try {
        const result = await this.send(notice, item);
        if (result && result.failed) {
          summary.failed += 1;
        } else if (result && result.skipped) {
          summary.skipped += 1;
        } else {
          summary.sent += 1;
        }
      } catch (error) {
        summary.failed += 1;
        this.logger.error({ subscriptionId: item.row.stripeSubscriptionId, code: error && error.code }, 'Plan notice failed.');
      }
    }
    return summary;
  }
}

module.exports = {
  PLAN_NOTICES_PER_TICK,
  PlanNoticesService
};
