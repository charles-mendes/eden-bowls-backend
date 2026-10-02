const RETIRE_JOB = 'stripe_ledger_retire';
const CUSTOMER_META_KEYS = [
  '_hsr_stripe_customer_id_br',
  '_hsr_stripe_customer_id_us',
  '_hsr_stripe_customer_id'
];

function readOptions(argv) {
  const runtime = String(process.env.EDEN_RUNTIME || '').trim();
  const confirm = argv.includes('--confirm-delete-ledger');
  const beforeIndex = argv.indexOf('--created-before');
  const createdBefore = beforeIndex >= 0 ? String(argv[beforeIndex + 1] || '').trim() : '';
  return { runtime, confirm, createdBefore };
}

function validateOptions({ runtime, confirm, createdBefore }) {
  if (runtime !== 'qa' && runtime !== 'local') {
    return 'EDEN_RUNTIME must be qa or local.';
  }
  if (!confirm) {
    return '--confirm-delete-ledger is required.';
  }
  if (!createdBefore || Number.isNaN(Date.parse(createdBefore))) {
    return '--created-before must be an ISO timestamp.';
  }
  return '';
}

async function retireStripeLedger({ dataSource, runtime, confirm, createdBefore, usermetaTable = 'wp_usermeta' }) {
  const error = validateOptions({ runtime, confirm, createdBefore });
  if (error) {
    const failure = new Error(error);
    failure.exitCode = 1;
    throw failure;
  }

  const existing = await dataSource.query(
    'SELECT `cursor` FROM `background_job_cursors` WHERE `job_name` = ? LIMIT 1',
    [RETIRE_JOB]
  );
  const cursor = existing && existing[0] ? String(existing[0].cursor) : '0';
  if (existing && existing[0] && cursor !== '0') {
    const failure = new Error('stripe_ledger_retire already ran.');
    failure.exitCode = 1;
    throw failure;
  }

  const rows = await dataSource.query(
    'SELECT `id`, `stripe_subscription_id` FROM `stripe_subscriptions` WHERE `created_at` < ?',
    [createdBefore]
  );
  const subscriptionIds = (Array.isArray(rows) ? rows : [])
    .map((row) => String(row.stripe_subscription_id || ''))
    .filter(Boolean);

  if (subscriptionIds.length > 0) {
    const placeholders = subscriptionIds.map(() => '?').join(', ');
    await dataSource.query(
      `DELETE FROM \`subscription_mail_claims\` WHERE \`stripe_subscription_id\` IN (${placeholders})`,
      subscriptionIds
    );
    await dataSource.query(
      `DELETE FROM \`ups_shipments\` WHERE \`subscription_id\` IN (${placeholders})`,
      subscriptionIds
    );
  }

  await dataSource.query(
    'DELETE FROM `stripe_subscriptions` WHERE `created_at` < ?',
    [createdBefore]
  );

  const metaPlaceholders = CUSTOMER_META_KEYS.map(() => '?').join(', ');
  await dataSource.query(
    `DELETE FROM \`${usermetaTable}\` WHERE \`meta_key\` IN (${metaPlaceholders})`,
    CUSTOMER_META_KEYS
  );

  await dataSource.query(
    'INSERT INTO `background_job_cursors` (`job_name`, `cursor`, `updated_at`) VALUES (?, ?, CURRENT_TIMESTAMP) ON DUPLICATE KEY UPDATE `cursor` = VALUES(`cursor`), `updated_at` = CURRENT_TIMESTAMP',
    [RETIRE_JOB, createdBefore]
  );

  return { deletedSubscriptions: Array.isArray(rows) ? rows.length : 0, cutoff: createdBefore };
}

async function main() {
  const options = readOptions(process.argv.slice(2));
  const error = validateOptions(options);
  if (error) {
    console.error(error);
    process.exit(1);
  }

  const { parseEnv } = require('../config/env');
  const { createDataSource } = require('../infrastructure/db');
  const env = parseEnv();
  const dataSource = createDataSource(env);
  await dataSource.initialize();
  try {
    const result = await retireStripeLedger({
      dataSource,
      ...options,
      usermetaTable: env.WP_USERMETA_TABLE_NAME
    });
    console.log(`Retired ${result.deletedSubscriptions} ledger rows created before ${result.cutoff}.`);
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.message ? error.message : error);
    process.exit(error && error.exitCode ? error.exitCode : 1);
  });
}

module.exports = {
  RETIRE_JOB,
  readOptions,
  validateOptions,
  retireStripeLedger
};
