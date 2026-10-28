const { automatedEmailSettingsPayload, parseAutomatedEmailSettings } = require('../core/automated-email-settings');

function actorIdOf(actor) {
  const id = actor && (actor.userId || actor.id);
  return id ? Number(id) : null;
}

const pick = ({ lifeStageChangeEnabled, announcementBatchSize, announcementDailyCap }) => ({ lifeStageChangeEnabled, announcementBatchSize, announcementDailyCap });

// Pause or limit the automated life-stage emails of a market (automated-email-settings). A save is recorded
// in the admin audit log as settings.email.update with the values before and after.
class AutomatedEmailSettingsService {
  constructor({ repository, auditRepository = null, dataSource = null } = {}) {
    this.repository = repository;
    this.auditRepository = auditRepository;
    this.dataSource = dataSource;
  }

  async read(market) {
    return automatedEmailSettingsPayload(market, await this.repository.forMarket(market));
  }

  async update(market, input, actor = {}) {
    const settings = parseAutomatedEmailSettings(input);
    const before = await this.repository.forMarket(market);
    const work = async (manager) => {
      await this.repository.save(market, settings, actorIdOf(actor), manager);
      if (this.auditRepository && typeof this.auditRepository.createIn === 'function') {
        await this.auditRepository.createIn(manager, {
          actorUserId: actorIdOf(actor),
          actorEmail: (actor && actor.email) || null,
          action: 'settings.email.update',
          metadata: { market, before: pick(before), after: settings }
        });
      }
    };
    if (this.dataSource && typeof this.dataSource.transaction === 'function') {
      await this.dataSource.transaction(work);
    } else {
      await work(this.dataSource);
    }
    return this.read(market);
  }
}

module.exports = {
  AutomatedEmailSettingsService
};
