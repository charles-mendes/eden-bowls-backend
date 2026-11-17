const { changedCompanyFields, companyProfilePayload, parseCompanyProfile } = require('../core/company-profile');
const { setCompanyProfile } = require('../core/email/company-directory');

const HISTORY_LIMIT = 50;

function actorIdOf(actor) {
  const id = actor && (actor.userId || actor.id);
  return id ? Number(id) : null;
}

// Reads and saves the company profile of a market (company-profile). A save is recorded in the admin audit
// log as settings.company.update with who saved it and the fields that changed, before and after. The read
// returns the latest saves of the market, newest first.
class CompanyProfileService {
  constructor({ repository, auditRepository = null, dataSource = null } = {}) {
    this.repository = repository;
    this.auditRepository = auditRepository;
    this.dataSource = dataSource;
  }

  async read(market) {
    const [profile, history] = await Promise.all([this.repository.forMarket(market), this.history(market)]);
    return { ...companyProfilePayload(market, profile), updated_at: profile.updatedAt || null, history };
  }

  async history(market) {
    if (!this.auditRepository || typeof this.auditRepository.listByActionPrefix !== 'function') return [];
    return this.auditRepository.listByActionPrefix({ actionPrefix: 'settings.company.', market, limit: HISTORY_LIMIT });
  }

  async update(market, input, actor = {}) {
    const profile = parseCompanyProfile(market, input);
    const before = await this.repository.forMarket(market);
    const fields = changedCompanyFields(before, profile);
    const beforePayload = companyProfilePayload(market, before);
    const afterPayload = companyProfilePayload(market, profile);
    const pick = (payload) => Object.fromEntries(fields.map((field) => [field, payload[field]]));
    const work = async (manager) => {
      await this.repository.save(market, profile, actorIdOf(actor), manager);
      if (this.auditRepository && typeof this.auditRepository.createIn === 'function') {
        await this.auditRepository.createIn(manager, {
          actorUserId: actorIdOf(actor),
          actorEmail: (actor && actor.email) || null,
          action: 'settings.company.update',
          metadata: { market, fields, before: pick(beforePayload), after: pick(afterPayload) }
        });
      }
    };
    if (this.dataSource && typeof this.dataSource.transaction === 'function') {
      await this.dataSource.transaction(work);
    } else {
      await work(this.dataSource);
    }
    // The letters of this process show the new data at once; other processes within the 60 s refresh.
    setCompanyProfile(market, await this.repository.forMarket(market));
    return this.read(market);
  }
}

module.exports = {
  CompanyProfileService
};
