const { HttpError } = require('../core/http-error');
const { PLAN_SETTINGS_MARKETS, parseLargePackLimit, parsePlanDays } = require('../core/plan-settings');

function actorIdOf(actor) {
  const id = actor && (actor.userId || actor.id);
  return id ? Number(id) : null;
}

function requireMarket(market) {
  const key = String(market || '').trim().toUpperCase();
  if (!PLAN_SETTINGS_MARKETS.includes(key)) {
    throw new HttpError(400, 'Choose one market.', { code: 'market_required' });
  }
  return key;
}

function present({ market, planDays, largePackLimit, updatedAt }) {
  return { market, planDays, largePackLimit, updatedAt: updatedAt || null };
}

// Reads and saves the plan settings of a market (plan-settings). A save that changes a value is recorded in the
// admin audit log as catalog.plan_settings.update with the previous and new values.
class PlanSettingsService {
  constructor({ repository, auditRepository = null, dataSource = null } = {}) {
    this.repository = repository;
    this.auditRepository = auditRepository;
    this.dataSource = dataSource;
  }

  async read(market) {
    return present(await this.repository.read(requireMarket(market)));
  }

  async update(market, input = {}, actor = {}) {
    const key = requireMarket(market);
    const next = {
      planDays: parsePlanDays(input.planDays),
      largePackLimit: parseLargePackLimit(input.largePackLimit)
    };
    const before = await this.repository.read(key);
    const changes = {};
    for (const field of ['planDays', 'largePackLimit']) {
      if (!before.stored || before[field] !== next[field]) {
        changes[field] = { from: before.stored ? before[field] : null, to: next[field] };
      }
    }
    if (Object.keys(changes).length === 0) {
      return present(before);
    }
    const work = async (manager) => {
      await this.repository.save(key, next, actorIdOf(actor), manager);
      if (this.auditRepository && typeof this.auditRepository.createIn === 'function') {
        await this.auditRepository.createIn(manager, {
          actorUserId: actorIdOf(actor),
          actorEmail: (actor && actor.email) || null,
          action: 'catalog.plan_settings.update',
          metadata: { market: key, changes }
        });
      }
    };
    if (this.dataSource && typeof this.dataSource.transaction === 'function') {
      await this.dataSource.transaction(work);
    } else {
      await work(this.dataSource);
    }
    return this.read(key);
  }
}

module.exports = {
  PlanSettingsService
};
