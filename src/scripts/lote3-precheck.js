require('reflect-metadata');

// Read-only survey before batch 3 (address and fiscal locks): how many open paid cycles each new rule would stop.
// Run: node src/scripts/lote3-precheck.js. It only runs SELECTs and prints JSON; in QA the numbers decide nothing.
const { parseEnv } = require('../config/env');
const { createDataSource } = require('../infrastructure/db');
const { SubscriptionLedgerRepository } = require('../infrastructure/repositories/subscription-ledger.repository');
const { PROFILE_MARKET_META_KEY } = require('../core/admin-market-scope');
const { FISCAL_NAME_META_KEY } = require('../core/tax-document');

const OPEN_DAYS = 30;
// Tables created by different migrations carry different collations; joins compare in one.
const same = (left, right) => `${left} COLLATE utf8mb4_unicode_ci = ${right} COLLATE utf8mb4_unicode_ci`;

const field = (key) => `NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(q.address, '$.${key}'))), '')`;
const country = `UPPER(${field('country')})`;

// One query per count, each a COUNT over the open paid cycles. Exported so the test can check every one is a SELECT.
function precheckQueries({ queueSourceSql, usermetaTable = 'wp_usermeta', nfeTable = 'bling_nfe', courierTable = 'courier_deliveries', upsTable = 'ups_shipments' }) {
  const open = [
    "q.payment_state = 'paid' AND q.paid_invoice_id IS NOT NULL",
    `COALESCE(q.delivery_date, DATE(q.cycle_period_end)) >= DATE_SUB(CURDATE(), INTERVAL ${OPEN_DAYS} DAY)`,
    `NOT EXISTS (SELECT 1 FROM \`${courierTable}\` cd WHERE ${same('cd.stripe_invoice_id', 'q.paid_invoice_id')} AND cd.status IN ('out_for_delivery', 'delivered'))`,
    `NOT EXISTS (SELECT 1 FROM \`${upsTable}\` us WHERE ${same('us.stripe_invoice_id', 'q.paid_invoice_id')} AND us.status IN ('created', 'delivered'))`
  ].join(' AND ');
  const count = (extra) => `SELECT COUNT(*) AS total FROM ${queueSourceSql} WHERE ${open}${extra ? ` AND ${extra}` : ''}`;
  const brazil = `${country} = 'BR'`;
  const incomplete = [
    `COALESCE(${field('street')}, ${field('address_line1')}, ${field('line1')}) IS NULL`,
    `${field('city')} IS NULL`,
    `${field('state')} IS NULL`,
    `COALESCE(${field('postal_code')}, ${field('zipcode')}) IS NULL`,
    `${country} IS NULL`,
    `(${brazil} AND (${field('number')} IS NULL OR ${field('neighborhood')} IS NULL))`
  ].join(' OR ');
  const nfe = `(SELECT n.status FROM \`${nfeTable}\` n WHERE ${same('n.stripe_invoice_id', 'q.paid_invoice_id')} ORDER BY n.id DESC LIMIT 1)`;
  const profileMarket = `(SELECT UPPER(m.meta_value) FROM \`${usermetaTable}\` m WHERE m.user_id = q.user_id AND m.meta_key = '${PROFILE_MARKET_META_KEY}' LIMIT 1)`;
  const account = 'UPPER(q.stripe_account) COLLATE utf8mb4_unicode_ci';
  return {
    openPaidCycles: count(''),
    incompleteAddress: count(`(${incomplete})`),
    brazilNfeNotAuthorized: count(`${brazil} AND ${nfe} IS NOT NULL AND ${nfe} <> 'authorized'`),
    brazilWithoutNfe: count(`${brazil} AND ${nfe} IS NULL`),
    brazilWithoutFiscalName: count(`${brazil} AND NOT EXISTS (SELECT 1 FROM \`${usermetaTable}\` f WHERE f.user_id = q.user_id AND f.meta_key = '${FISCAL_NAME_META_KEY}' AND TRIM(f.meta_value) <> '')`),
    addressCountryOtherThanAccount: count(`((${brazil} AND q.stripe_account <> 'br') OR (${country} = 'US' AND q.stripe_account <> 'us'))`),
    // X-03: the profile market and the Stripe account disagree.
    profileMarketOtherThanAccount: count(`${profileMarket} IS NOT NULL AND ${profileMarket} COLLATE utf8mb4_unicode_ci <> ${account}`)
  };
}

async function main() {
  const env = parseEnv();
  const dataSource = createDataSource(env);
  await dataSource.initialize();
  try {
    const ledger = new SubscriptionLedgerRepository(dataSource);
    const queries = precheckQueries({ queueSourceSql: ledger.queueSourceSql() });
    const counts = {};
    for (const [name, sql] of Object.entries(queries)) {
      const [row] = await dataSource.query(sql);
      counts[name] = Number((row && row.total) || 0);
    }
    console.log(JSON.stringify({ openWindowDays: OPEN_DAYS, generatedAt: new Date().toISOString(), counts }, null, 2));
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

module.exports = { precheckQueries };
