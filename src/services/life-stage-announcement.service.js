const { allowedLifeStages, isOutsideAllowed, planLinesForPet, planPetIds } = require('../core/life-stage-lines');
const { firstNameFrom } = require('../core/email/mail-context');
const { companyAddressFromEnv, formatCompanyAddress, missingCompanyAddress } = require('../core/email/company-address');
const { buildLifeStageAnnouncementEmail, packsUrl } = require('../core/email/life-stage-emails');

const TEMPLATE = 'life_stage_announcement';
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_DAILY_CAP = 300;
const MARKETS = ['BR', 'US'];

class AnnouncementRefused extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function positiveInt(value, fallback) {
  const number = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

const ANNOUNCED_STAGES = ['puppy', 'senior'];

// Launch announcement (customer-life-stage-notice, design decision 9): per market, the opted-in customers whose
// delivering plans include a puppy or a senior not yet named and outside its allowed line, with the recipes of
// that dog's stage. A dog already on its line is left out.
class LifeStageAnnouncementService {
  constructor(options = {}) {
    this.lifeStageService = options.lifeStageService;
    this.repository = options.repository;
    this.noticesRepository = options.noticesRepository || null;
    this.mailer = options.mailer || null;
    this.storeAppUrl = String(options.storeAppUrl || 'http://localhost:5173').replace(/\/+$/, '');
    this.emailAssetBaseUrl = options.emailAssetBaseUrl || '';
    this.env = options.env || process.env;
    this.wait = options.wait || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.batchPauseMs = options.batchPauseMs == null ? 1000 : options.batchPauseMs;
    this.now = options.now || (() => new Date());
  }

  // Manual per-market run (`npm run life-stage:announce`). Without `send`, a simulation that writes nothing.
  async run({ market, send = false } = {}) {
    const code = String(market || '').toUpperCase();
    if (!MARKETS.includes(code)) {
      throw new AnnouncementRefused('invalid_market', 'Informe o mercado: --market BR ou --market US.');
    }
    const { stages } = await this.announcedStages(code);
    if (stages.length === 0) {
      throw new AnnouncementRefused('no_published_recipes', `Nenhuma receita de filhote ou sênior publicada em ${code}. Nada a anunciar.`);
    }
    const state = await this.repository.findMarket(code);
    const recipients = await this.recipients(code);
    const summary = {
      market: code,
      mode: send ? 'send' : 'simulation',
      stages,
      already_sent_at: state && state.sent_at ? new Date(state.sent_at).toISOString() : null,
      customers: recipients.length,
      pets: recipients.reduce((total, recipient) => total + recipient.dogs.length, 0),
      recipients: recipients.map((recipient) => ({
        user_id: recipient.userId,
        email: recipient.email,
        dogs: recipient.dogs.map((dog) => ({ pet_id: dog.petId, name: dog.petName, stage: dog.stage, subscription_id: dog.subscriptionId }))
      }))
    };
    if (!send) {
      return summary;
    }

    if (state && state.sent_at) {
      throw new AnnouncementRefused('already_sent', `O anúncio de ${code} já foi concluído em ${summary.already_sent_at}. Nada foi enviado.`);
    }
    const missing = missingCompanyAddress(code, this.env);
    if (missing.length > 0) {
      throw new AnnouncementRefused('company_address_missing', `Envio recusado: configure ${missing.join(' e ')} (empresa e rua do rodapé do anúncio de ${code}). Nada foi enviado.`);
    }
    if (!this.mailer || typeof this.mailer.sendClaimed !== 'function') {
      throw new AnnouncementRefused('mailer_unavailable', 'O envio de e-mail não está configurado. Nada foi enviado.');
    }

    const startedAt = this.now();
    await this.repository.markStarted(code, startedAt);
    const dailyCap = positiveInt(this.env.LIFE_STAGE_ANNOUNCEMENT_DAILY_CAP, DEFAULT_DAILY_CAP);
    const batchSize = positiveInt(this.env.LIFE_STAGE_ANNOUNCEMENT_BATCH_SIZE, DEFAULT_BATCH_SIZE);
    const sentToday = await this.repository.countAnnouncedCustomersSince(code.toLowerCase(), startOfUtcDay(startedAt));
    const budget = Math.max(0, dailyCap - sentToday);
    const batch = recipients.slice(0, budget);
    const companyLine = formatCompanyAddress(code, companyAddressFromEnv(code, this.env));

    let sent = 0;
    let failed = 0;
    for (let index = 0; index < batch.length; index += 1) {
      if (index > 0 && index % batchSize === 0 && this.batchPauseMs > 0) {
        await this.wait(this.batchPauseMs);
      }
      const recipient = batch[index];
      const result = await this.sendOne(code, recipient, companyLine);
      if (result && (result.claimed || result.reason === 'duplicate')) {
        const at = this.now();
        await this.repository.markPetsAnnounced(recipient.dogs, at);
        if (this.noticesRepository) {
          for (const dog of recipient.dogs) {
            await this.noticesRepository.markAnnounced(dog.petId, dog.stage, at);
          }
        }
        sent += 1;
      } else {
        failed += 1;
      }
    }

    const remaining = recipients.length - sent;
    let sentAt = null;
    if (remaining === 0) {
      sentAt = this.now();
      await this.repository.markSent(code, sentAt);
    }
    return {
      ...summary,
      daily_cap: dailyCap,
      sent_today_before: sentToday,
      sent,
      failed,
      remaining,
      sent_at: sentAt ? sentAt.toISOString() : null
    };
  }

  async sendOne(market, recipient, companyLine) {
    const locale = market === 'BR' ? 'pt-BR' : 'en-US';
    const content = buildLifeStageAnnouncementEmail({
      firstName: recipient.firstName,
      dogs: recipient.dogs.map((dog) => ({
        petName: dog.petName,
        stage: dog.stage,
        recipes: dog.recipes,
        adjustUrl: packsUrl(this.storeAppUrl, dog.subscriptionId, dog.petId)
      })),
      profileUrl: `${this.storeAppUrl}/dashboard/profile`,
      companyLine,
      locale,
      assetBaseUrl: this.emailAssetBaseUrl
    });
    return this.mailer.sendClaimed({
      subscriptionId: recipient.dogs[0].subscriptionId,
      template: TEMPLATE,
      referenceId: `${market}:user:${recipient.userId}`,
      to: recipient.email,
      content
    });
  }

  // Stages with a published recipe in the market: only those are announced.
  async announcedStages(market) {
    const lines = await this.lifeStageService.recipeLines(market);
    const published = lines && lines.publishedLines ? lines.publishedLines : new Set();
    return { lines, stages: ANNOUNCED_STAGES.filter((stage) => published.has(stage)) };
  }

  // One entry per customer, each dog named once even when it sits on two plans.
  async recipients(market) {
    const { lines, stages } = await this.announcedStages(market);
    if (stages.length === 0) {
      return [];
    }
    const recipes = (stage) => (lines.publishedRecipes || [])
      .filter((recipe) => recipe.life_stage === stage)
      .map((recipe) => String(recipe.label || recipe.key));

    const candidates = await this.repository.listCandidates(String(market).toLowerCase());
    const byUser = new Map();
    const named = new Set();
    for (const plan of candidates) {
      const onPlan = new Set(planPetIds(plan.planSelection));
      const pets = plan.pets.filter((pet) => onPlan.has(pet.id) && !named.has(pet.id));
      const results = await this.lifeStageService.resolveMany(pets, market);
      pets.forEach((pet, index) => {
        const stage = results[index] && results[index].lifeStage;
        if (!stages.includes(stage)) return;
        const allowed = allowedLifeStages(stage, lines.publishedLines);
        if (!isOutsideAllowed(planLinesForPet(plan.planSelection, pet.id, lines.lineByKey), allowed)) return;
        named.add(pet.id);
        const recipient = byUser.get(plan.userId) || {
          userId: plan.userId,
          email: plan.email,
          firstName: firstNameFrom({ address: plan.address }),
          dogs: []
        };
        recipient.dogs.push({
          petId: pet.id,
          petName: pet.name,
          stage,
          subscriptionRowId: plan.id,
          subscriptionId: plan.stripeSubscriptionId,
          recipes: recipes(stage)
        });
        byUser.set(plan.userId, recipient);
      });
    }
    return [...byUser.values()].filter((recipient) => recipient.email);
  }
}

module.exports = {
  ANNOUNCED_STAGES,
  AnnouncementRefused,
  DEFAULT_BATCH_SIZE,
  DEFAULT_DAILY_CAP,
  LifeStageAnnouncementService
};
