// Launch announcement of the life-stage recipes, run by hand per market (customer-life-stage-notice).
//   npm run life-stage:announce -- --market BR          simulation: who would receive it, nothing sent or marked
//   npm run life-stage:announce -- --market BR --send   real send, up to the daily cap; run again on a later day
const STAGE_LABELS = { puppy: 'Filhote', senior: 'Sênior', adult: 'Adulto' };

function parseArgs(argv = process.argv.slice(2)) {
  const index = argv.indexOf('--market');
  const inline = argv.find((arg) => arg.startsWith('--market='));
  return {
    market: String(inline ? inline.split('=')[1] : (index >= 0 ? argv[index + 1] : '') || '').toUpperCase(),
    send: argv.includes('--send')
  };
}

function formatSummary(summary) {
  const lines = [];
  const title = summary.mode === 'send' ? `Envio ${summary.market}` : `Simulação ${summary.market} (nada foi enviado nem marcado)`;
  lines.push(`${title}: ${summary.customers} cliente(s), ${summary.pets} pet(s).`);
  if (summary.already_sent_at) {
    lines.push(`Anúncio deste mercado já concluído em ${summary.already_sent_at}.`);
  }
  for (const recipient of summary.recipients) {
    const dogs = recipient.dogs.map((dog) => `${dog.name} (${STAGE_LABELS[dog.stage] || dog.stage}, ${dog.subscription_id})`).join('; ');
    lines.push(`- cliente ${recipient.user_id} <${recipient.email}>: ${dogs}`);
  }
  if (summary.mode === 'send') {
    lines.push(`Enviados agora: ${summary.sent}. Falhas: ${summary.failed}. Limite diário: ${summary.daily_cap} (já enviados hoje antes desta execução: ${summary.sent_today_before}).`);
    lines.push(summary.remaining > 0
      ? `Faltam ${summary.remaining} cliente(s). Rode de novo com --send em outro dia para continuar.`
      : `Concluído. sent_at = ${summary.sent_at}: o e-mail de mudança de fase passa a valer em ${summary.market}.`);
  }
  return lines.join('\n');
}

async function main() {
  const { market, send } = parseArgs();
  const { parseEnv } = require('../config/env');
  const { createDataSource } = require('../infrastructure/db');
  const { createLogger } = require('../core/logger');
  const { createOtpMailer } = require('../infrastructure/mailers/otp-mailer');
  const { createTransactionalMailer } = require('../infrastructure/mailers/transactional-mailer');
  const { AdminCatalogRepository } = require('../infrastructure/repositories/admin-catalog.repository');
  const { LifeStageLimitsRepository } = require('../infrastructure/repositories/life-stage-limits.repository');
  const { LifeStageAnnouncementsRepository } = require('../infrastructure/repositories/life-stage-announcements.repository');
  const { PetLifeStageNoticesRepository } = require('../infrastructure/repositories/pet-life-stage-notices.repository');
  const { SubscriptionMailClaimsRepository } = require('../infrastructure/repositories/subscription-mail-claims.repository');
  const { LifeStageService } = require('../services/life-stage.service');
  const { CompanyProfilesRepository } = require('../infrastructure/repositories/company-profiles.repository');
  const { AutomatedEmailSettingsRepository } = require('../infrastructure/repositories/automated-email-settings.repository');
  const { refreshCompanyDirectory } = require('../core/email/company-directory');
  const { AnnouncementRefused, LifeStageAnnouncementService } = require('../services/life-stage-announcement.service');

  const env = parseEnv();
  const logger = createLogger({ level: env.LOG_LEVEL, nodeEnv: env.NODE_ENV });
  const dataSource = createDataSource(env);
  await dataSource.initialize();
  try {
    const companyProfiles = new CompanyProfilesRepository(dataSource);
    // The letters' footer reads the support email of the market profile.
    await refreshCompanyDirectory(companyProfiles, logger);
    const otpMailer = createOtpMailer({
      logger,
      nodeEnv: env.NODE_ENV,
      emailAssetBaseUrl: env.EMAIL_ASSET_BASE_URL,
      smtp: {
        host: env.AUTH_SMTP_HOST,
        port: env.AUTH_SMTP_PORT,
        user: env.AUTH_SMTP_USER,
        pass: env.AUTH_SMTP_PASS,
        encryption: env.AUTH_SMTP_ENCRYPTION,
        auth: env.AUTH_SMTP_AUTH,
        from: env.AUTH_MAIL_FROM,
        fromName: env.AUTH_MAIL_FROM_NAME
      }
    });
    const service = new LifeStageAnnouncementService({
      lifeStageService: new LifeStageService({
        repository: new LifeStageLimitsRepository(dataSource),
        recipeLinesRepository: new AdminCatalogRepository(dataSource, {
          postsTableName: env.WP_POSTS_TABLE_NAME,
          postmetaTableName: env.WP_POSTMETA_TABLE_NAME,
          termRelationshipsTableName: env.WP_TERM_RELATIONSHIPS_TABLE_NAME
        })
      }),
      repository: new LifeStageAnnouncementsRepository(dataSource),
      noticesRepository: new PetLifeStageNoticesRepository(dataSource),
      mailer: createTransactionalMailer({
        logger,
        otpMailer,
        claimsRepository: new SubscriptionMailClaimsRepository(dataSource),
        storeAppUrl: env.STORE_APP_URL,
        emailAssetBaseUrl: env.EMAIL_ASSET_BASE_URL
      }),
      storeAppUrl: env.STORE_APP_URL,
      emailAssetBaseUrl: env.EMAIL_ASSET_BASE_URL,
      companyProfiles,
      settings: new AutomatedEmailSettingsRepository(dataSource)
    });
    try {
      console.log(formatSummary(await service.run({ market, send })));
    } catch (error) {
      if (error instanceof AnnouncementRefused) {
        console.error(error.message);
        process.exitCode = 1;
        return;
      }
      throw error;
    }
  } finally {
    await dataSource.destroy();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  formatSummary,
  parseArgs
};
