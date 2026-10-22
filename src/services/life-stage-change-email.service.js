const DAY_MS = 24 * 60 * 60 * 1000;
const SEND_DAYS_BEFORE_CUTOFF = 7;
const MARKETS = ['BR', 'US'];

// Daily stage-change email (customer-life-stage-notice, design decision 7). Per market, only after that market's
// launch announcement was sent. A transition is emailed once, 7 days before the cutoff of the delivery the
// adjustment still applies to, or at the first run inside that window. Each market has an emergency switch
// (LIFE_STAGE_CHANGE_EMAIL_ENABLED_<BR|US>): off, the market is skipped before any read or write, so turning it
// on again sends the emails whose time came during the pause at the next run, by the late-detection rule.
class LifeStageChangeEmailService {
  constructor(options = {}) {
    this.ledgerRepository = options.ledgerRepository;
    this.noticesService = options.noticesService;
    this.noticesRepository = options.noticesRepository;
    this.announcementsRepository = options.announcementsRepository;
    this.deliveriesService = options.deliveriesService;
    this.petsRepository = options.petsRepository;
    this.mailer = options.mailer;
    // Per market; a market missing here is on.
    this.enabled = options.enabled || {};
    this.logger = options.logger || { warn() {}, error() {} };
    this.now = options.now || (() => new Date());
  }

  async runDaily() {
    const summary = {};
    for (const market of MARKETS) {
      summary[market] = await this.runMarket(market);
    }
    return summary;
  }

  async runMarket(market) {
    if (this.enabled[market] === false) {
      this.logger.warn({ market }, `Stage-change email paused in this market (LIFE_STAGE_CHANGE_EMAIL_ENABLED_${market}=false).`);
      return { skipped: 'paused' };
    }
    const state = await this.announcementsRepository.findMarket(market);
    if (!state || !state.sent_at) {
      return { skipped: 'announcement_not_sent' };
    }
    const rows = await this.ledgerRepository.listDeliverableByAccount(market === 'BR' ? 'br' : 'us');
    const byUser = new Map();
    for (const row of rows) {
      byUser.set(row.userId, [...(byUser.get(row.userId) || []), row]);
    }

    const result = { sent: 0, waiting: 0, skipped: 0, failed: 0 };
    for (const [userId, userRows] of byUser) {
      // Also opens the notice rows of customers who have not opened Meu plano since the transition.
      const reports = await this.noticesService.reportForUser(userId, userRows);
      let names = null;
      for (const row of userRows) {
        for (const entry of reports.get(row.id) || []) {
          const notice = entry.life_stage_notice;
          if (!entry.life_stage_mismatch || !notice || !notice.open || notice.notified_via) continue;
          if (await this.noticesRepository.transitionNotified(entry.pet_id, notice.from_line, notice.to_line)) {
            result.skipped += 1;
            continue;
          }
          const { editableUntil, passedCutoff } = await this.deadlines(row);
          if (!editableUntil) {
            result.waiting += 1;
            continue;
          }
          const at = this.now();
          // Detected less than 7 days before a cutoff that passed before any run sent it: send now.
          const missedWindow = Boolean(passedCutoff && notice.detected_at
            && new Date(notice.detected_at).getTime() < new Date(passedCutoff).getTime());
          if (!missedWindow && at.getTime() < new Date(editableUntil).getTime() - SEND_DAYS_BEFORE_CUTOFF * DAY_MS) {
            result.waiting += 1;
            continue;
          }
          if (!names) names = await this.petNames(userId);
          const sent = await this.mailer.notifyLifeStageChange({
            ledger: row,
            petId: entry.pet_id,
            petName: names.get(entry.pet_id) || '',
            fromLine: notice.from_line,
            toLine: notice.to_line,
            suggestedRecipes: (entry.suggested_recipes || []).map((recipe) => recipe.label || recipe.key),
            editableUntil
          });
          if (sent && (sent.claimed || sent.reason === 'duplicate')) {
            await this.noticesRepository.markEmailed({
              subscriptionId: row.id,
              petId: entry.pet_id,
              fromLine: notice.from_line,
              toLine: notice.to_line,
              at
            });
            result.sent += sent.claimed ? 1 : 0;
          } else {
            result.failed += 1;
          }
        }
      }
    }
    return result;
  }

  // editable_until of the delivery the deliveries read lets the customer change now (current or following),
  // and the current delivery's cutoff when it already passed.
  async deadlines(row) {
    try {
      const subscription = await this.deliveriesService.loadSubscription(row.stripeSubscriptionId, row.userId);
      const read = await this.deliveriesService.read(subscription, row.userId);
      const target = read && read.actionTarget;
      if (!target || !target.editableUntil) return { editableUntil: null, passedCutoff: null };
      const current = read.delivery && read.delivery.editableUntil;
      const passed = target.id === 'following' && current && new Date(current).getTime() <= this.now().getTime();
      return { editableUntil: target.editableUntil, passedCutoff: passed ? current : null };
    } catch (error) {
      this.logger.warn({ subscriptionId: row.stripeSubscriptionId, message: error && error.message }, 'Stage-change email: deliveries read failed.');
      return { editableUntil: null, passedCutoff: null };
    }
  }

  async petNames(userId) {
    const data = this.petsRepository ? await this.petsRepository.listPets(userId) : { pets: [] };
    return new Map((data && Array.isArray(data.pets) ? data.pets : []).map((pet) => [String(pet.id), String(pet.name || '')]));
  }
}

module.exports = {
  SEND_DAYS_BEFORE_CUTOFF,
  LifeStageChangeEmailService
};
