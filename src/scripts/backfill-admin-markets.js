const { PROFILE_MARKET_META_KEY } = require('../core/admin-market-scope');

function parseArgs(argv = process.argv.slice(2)) {
  return {
    dryRun: argv.includes('--dry-run')
  };
}

async function collectBackfillStats(query) {
  const fillableProfileRows = await query(
    [
      'SELECT COUNT(*) AS total',
      'FROM `wp_users` u',
      "INNER JOIN `onboarding_user_state` s ON s.user_id = u.ID",
      "LEFT JOIN `wp_usermeta` pm ON pm.user_id = u.ID AND pm.meta_key = ?",
      "WHERE (pm.meta_value IS NULL OR TRIM(pm.meta_value) = '')",
      "AND UPPER(TRIM(JSON_UNQUOTE(JSON_EXTRACT(s.address, '$.country')))) IN ('BR', 'US')"
    ].join(' '),
    [PROFILE_MARKET_META_KEY]
  );
  const fillableOnboardingRows = await query(
    [
      'SELECT COUNT(*) AS total',
      'FROM `onboarding_user_state` s',
      "WHERE (s.market IS NULL OR TRIM(s.market) = '')",
      "AND UPPER(TRIM(JSON_UNQUOTE(JSON_EXTRACT(s.address, '$.country')))) IN ('BR', 'US')"
    ].join(' ')
  );
  const orphanRows = await query(
    [
      'SELECT COUNT(*) AS total',
      'FROM `wp_users` u',
      "LEFT JOIN `wp_usermeta` pm ON pm.user_id = u.ID AND pm.meta_key = ?",
      "LEFT JOIN `onboarding_user_state` s ON s.user_id = u.ID",
      "WHERE (pm.meta_value IS NULL OR TRIM(pm.meta_value) = '')",
      "AND (s.address IS NULL OR UPPER(TRIM(JSON_UNQUOTE(JSON_EXTRACT(s.address, '$.country')))) NOT IN ('BR', 'US'))"
    ].join(' '),
    [PROFILE_MARKET_META_KEY]
  );
  const conflictRows = await query(
    [
      'SELECT COUNT(*) AS total',
      'FROM `stripe_subscriptions` sub',
      `INNER JOIN \`wp_usermeta\` pm ON pm.user_id = sub.user_id AND pm.meta_key = ?`,
      "WHERE UPPER(TRIM(pm.meta_value)) IN ('BR', 'US')",
      "AND LOWER(TRIM(sub.stripe_account)) IN ('br', 'us')",
      "AND LOWER(TRIM(sub.stripe_account)) <> LOWER(TRIM(CASE WHEN UPPER(TRIM(pm.meta_value)) = 'BR' THEN 'br' ELSE 'us' END))"
    ].join(' '),
    [PROFILE_MARKET_META_KEY]
  );

  return {
    fillableProfiles: Number(fillableProfileRows && fillableProfileRows[0] && fillableProfileRows[0].total || 0),
    fillableOnboarding: Number(fillableOnboardingRows && fillableOnboardingRows[0] && fillableOnboardingRows[0].total || 0),
    orphansWithoutCountry: Number(orphanRows && orphanRows[0] && orphanRows[0].total || 0),
    profileVsStripeConflicts: Number(conflictRows && conflictRows[0] && conflictRows[0].total || 0)
  };
}

async function applyBackfill(query) {
  await query(
    [
      'UPDATE `wp_usermeta` pm',
      'INNER JOIN `onboarding_user_state` s ON s.user_id = pm.user_id',
      "SET pm.meta_value = UPPER(TRIM(JSON_UNQUOTE(JSON_EXTRACT(s.address, '$.country'))))",
      'WHERE pm.meta_key = ?',
      "AND (pm.meta_value IS NULL OR TRIM(pm.meta_value) = '')",
      "AND UPPER(TRIM(JSON_UNQUOTE(JSON_EXTRACT(s.address, '$.country')))) IN ('BR', 'US')"
    ].join(' '),
    [PROFILE_MARKET_META_KEY]
  );

  await query(
    [
      'INSERT INTO `wp_usermeta` (`user_id`, `meta_key`, `meta_value`)',
      "SELECT s.user_id, ?, UPPER(TRIM(JSON_UNQUOTE(JSON_EXTRACT(s.address, '$.country'))))",
      'FROM `onboarding_user_state` s',
      'WHERE NOT EXISTS (SELECT 1 FROM `wp_usermeta` pm WHERE pm.user_id = s.user_id AND pm.meta_key = ?)',
      "AND UPPER(TRIM(JSON_UNQUOTE(JSON_EXTRACT(s.address, '$.country')))) IN ('BR', 'US')"
    ].join(' '),
    [PROFILE_MARKET_META_KEY, PROFILE_MARKET_META_KEY]
  );

  await query(
    [
      'UPDATE `onboarding_user_state` s',
      "SET s.market = UPPER(TRIM(JSON_UNQUOTE(JSON_EXTRACT(s.address, '$.country'))))",
      "WHERE (s.market IS NULL OR TRIM(s.market) = '')",
      "AND UPPER(TRIM(JSON_UNQUOTE(JSON_EXTRACT(s.address, '$.country')))) IN ('BR', 'US')"
    ].join(' ')
  );
}

async function runBackfill({ query, dryRun = true, log = console }) {
  const stats = await collectBackfillStats(query);
  log.log(JSON.stringify({ dryRun, ...stats }));
  if (!dryRun) {
    await applyBackfill(query);
  }
  return stats;
}

async function main() {
  const { dryRun } = parseArgs();
  const { parseEnv } = require('../config/env');
  const { createDataSource } = require('../infrastructure/db');
  const env = parseEnv();
  const dataSource = createDataSource(env);
  await dataSource.initialize();
  try {
    await runBackfill({
      query: (sql, params) => dataSource.query(sql, params),
      dryRun
    });
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
  applyBackfill,
  collectBackfillStats,
  parseArgs,
  runBackfill
};
