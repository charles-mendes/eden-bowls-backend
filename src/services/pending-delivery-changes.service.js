const { extractSubscriptionPeriod } = require('../core/stripe-subscription-map');

// A change to the following delivery recorded while the current delivery was still unpaid. It is applied
// by the invoice.paid of the current delivery's cycle: packs first, then the charge move, both without proration.
class PendingDeliveryChangesService {
  constructor(options = {}) {
    this.ledgerRepository = options.ledgerRepository || null;
    this.editCommitRepository = options.editCommitRepository || null;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.now = options.now || (() => new Date());
  }

  // `subscription` is the Stripe subscription retrieved for this invoice.paid. Throws so the event is retried;
  // the change is taken from the ledger first and put back on failure, so it is applied once.
  async applyAfterCharge({ subscriptionId, subscription, billing }) {
    const ledger = this.ledgerRepository;
    if (!ledger || typeof ledger.takePendingDeliveryChanges !== 'function') return null;
    const row = await ledger.findByStripeSubscriptionId(subscriptionId);
    const pending = row && row.pendingDeliveryChanges;
    if (!pending) return null;

    // Only the charge the change was recorded against releases it. An older invoice replayed late does not.
    const recordedAgainst = Date.parse(pending.after_charge_at);
    const periodStart = Number(extractSubscriptionPeriod(subscription || {}).start) * 1000;
    if (!Number.isFinite(recordedAgainst) || !Number.isFinite(periodStart) || periodStart < recordedAgainst) {
      return null;
    }

    const taken = await ledger.takePendingDeliveryChanges(subscriptionId);
    if (!taken) return null;
    const applied = { packs: false, chargeMove: false };
    try {
      if (taken.packs && taken.packs.payload) {
        if (!this.editCommitRepository) {
          throw new Error('Pending pack change cannot be applied without the edit commit repository.');
        }
        await this.editCommitRepository.commit(row.userId, subscriptionId, taken.packs.payload);
        applied.packs = true;
      }
      const move = taken.charge_move;
      if (move && Number(move.trial_end) > 0) {
        if (Number(move.trial_end) * 1000 <= this.now().getTime()) {
          this.logger.warn({ subscriptionId, kind: move.kind }, 'Pending delivery change dropped: its charge date has passed.');
        } else {
          if (!billing || typeof billing.setTrialEnd !== 'function') {
            throw new Error('Stripe billing cannot move the following charge.');
          }
          await billing.setTrialEnd({
            subscriptionId,
            trial_end: Number(move.trial_end),
            proration_behavior: 'none'
          });
          applied.chargeMove = true;
        }
      }
      return applied;
    } catch (error) {
      // Put back what was not applied, so the retried event finishes it.
      const rest = { ...taken };
      if (applied.packs) delete rest.packs;
      if (applied.chargeMove) delete rest.charge_move;
      await ledger.setPendingDeliveryChanges(subscriptionId, rest.packs || rest.charge_move ? rest : null);
      throw error;
    }
  }
}

module.exports = {
  PendingDeliveryChangesService
};
