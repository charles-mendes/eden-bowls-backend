const { toMysqlDateTime } = require('../../core/stripe-subscription-map');

const TABLE = 'delivery_address_issues';

function parseCodes(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function mapRow(row) {
  return {
    id: Number(row.id),
    subscriptionId: Number(row.subscription_id),
    stripeSubscriptionId: row.stripe_subscription_id,
    userId: Number(row.user_id),
    stripeAccount: row.stripe_account,
    codes: parseCodes(row.issue_codes),
    source: row.source,
    open: row.open_key != null,
    openedAt: row.opened_at || null,
    emailSentAt: row.email_sent_at || null,
    resolvedAt: row.resolved_at || null,
    resolvedBy: row.resolved_by || null
  };
}

function isDuplicate(error) {
  return Boolean(error && (error.code === 'ER_DUP_ENTRY' || error.errno === 1062));
}

// Address problems of subscriptions (delivery-address-issues). `subscription_id` is the ledger id.
class DeliveryAddressIssuesRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    // close-address-issues-when-subscription-ends: the tables the "ended" rule reads, with the ledger's defaults.
    this.ledgerTableName = options.ledgerTableName || 'stripe_subscriptions';
    this.productionCyclesTableName = options.productionCyclesTableName || 'subscription_production_cycles';
    this.courierTableName = options.courierTableName || 'courier_deliveries';
    this.upsTableName = options.upsTableName || 'ups_shipments';
  }

  async findOpen(subscriptionId) {
    const rows = await this.dataSource.query(
      `SELECT * FROM \`${TABLE}\` WHERE \`open_key\` = ? LIMIT 1`,
      [String(subscriptionId)]
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  // Opens a problem. Two events racing for the same subscription meet on the unique `open_key`: the loser reads the
  // winner and inserts nothing. Returns `{ inserted, issue }`.
  async insertOpen({ subscriptionId, stripeSubscriptionId, userId, stripeAccount, codes, source, now = new Date() }) {
    try {
      const result = await this.dataSource.query(
        `INSERT INTO \`${TABLE}\`
          (\`subscription_id\`, \`stripe_subscription_id\`, \`user_id\`, \`stripe_account\`, \`issue_codes\`, \`source\`, \`open_key\`, \`opened_at\`)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [subscriptionId, stripeSubscriptionId, userId, stripeAccount, JSON.stringify(codes), source, String(subscriptionId), toMysqlDateTime(now)]
      );
      const rows = await this.dataSource.query(`SELECT * FROM \`${TABLE}\` WHERE \`id\` = ?`, [result.insertId]);
      return { inserted: true, issue: mapRow(rows[0]) };
    } catch (error) {
      if (!isDuplicate(error)) throw error;
      return { inserted: false, issue: await this.findOpen(subscriptionId) };
    }
  }

  // Only an open problem closes; a second close of the same row changes nothing.
  async close(id, { resolvedBy, now = new Date() }) {
    const result = await this.dataSource.query(
      `UPDATE \`${TABLE}\` SET \`open_key\` = NULL, \`resolved_at\` = ?, \`resolved_by\` = ?
       WHERE \`id\` = ? AND \`open_key\` IS NOT NULL`,
      [toMysqlDateTime(now), resolvedBy, id]
    );
    return Number(result && result.affectedRows) > 0;
  }

  // close-address-issues-when-subscription-ends: closes as `ended` the open problems of canceled subscriptions
  // (the ledger stores Stripe's incomplete_expired as canceled) with no paid cycle whose box has not left. A box has
  // left with a courier delivery on the road or delivered, or a UPS label created or delivered (as in the market
  // exceptions list). No date floor. One subscription (ledger id) or, with null, all. Returns how many closed.
  async closeEnded({ subscriptionId = null, now = new Date() } = {}) {
    const same = (left, right) => `${left} COLLATE utf8mb4_unicode_ci = ${right} COLLATE utf8mb4_unicode_ci`;
    const where = [
      'i.`open_key` IS NOT NULL',
      "s.`status` = 'canceled'",
      `NOT EXISTS (SELECT 1 FROM \`${this.productionCyclesTableName}\` c
        WHERE c.subscription_id = s.id AND c.paid_at IS NOT NULL AND c.paid_invoice_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM \`${this.courierTableName}\` cd WHERE ${same('cd.stripe_invoice_id', 'c.paid_invoice_id')} AND cd.status IN ('out_for_delivery', 'delivered'))
          AND NOT EXISTS (SELECT 1 FROM \`${this.upsTableName}\` us WHERE ${same('us.stripe_invoice_id', 'c.paid_invoice_id')} AND us.status IN ('created', 'delivered')))`
    ];
    const params = [toMysqlDateTime(now)];
    if (subscriptionId != null) {
      const id = Number(subscriptionId);
      if (!Number.isSafeInteger(id) || id <= 0) return 0;
      where.push('i.`subscription_id` = ?');
      params.push(id);
    }
    const result = await this.dataSource.query(
      `UPDATE \`${TABLE}\` i JOIN \`${this.ledgerTableName}\` s ON s.id = i.subscription_id
       SET i.\`open_key\` = NULL, i.\`resolved_at\` = ?, i.\`resolved_by\` = 'ended'
       WHERE ${where.join(' AND ')}`,
      params
    );
    return Number(result && result.affectedRows) || 0;
  }

  async updateCodes(id, codes) {
    await this.dataSource.query(
      `UPDATE \`${TABLE}\` SET \`issue_codes\` = ? WHERE \`id\` = ? AND \`open_key\` IS NOT NULL`,
      [JSON.stringify(codes), id]
    );
  }

  async markEmailSent(id, now = new Date()) {
    await this.dataSource.query(
      `UPDATE \`${TABLE}\` SET \`email_sent_at\` = ? WHERE \`id\` = ?`,
      [toMysqlDateTime(now), id]
    );
  }

  async listOpenByUser(userId) {
    const rows = await this.dataSource.query(
      `SELECT * FROM \`${TABLE}\` WHERE \`user_id\` = ? AND \`open_key\` IS NOT NULL ORDER BY \`id\``,
      [userId]
    );
    return rows.map(mapRow);
  }

  // Per subscription: the open problem, or else the last one resolved since `since`. One query for a whole page.
  async latestForSubscriptions(subscriptionIds = [], { since }) {
    const ids = [...new Set(subscriptionIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
    const latest = new Map();
    if (ids.length === 0) return latest;
    const rows = await this.dataSource.query(
      `SELECT * FROM \`${TABLE}\`
       WHERE \`subscription_id\` IN (${ids.map(() => '?').join(', ')})
         AND (\`open_key\` IS NOT NULL OR \`resolved_at\` >= ?)
       ORDER BY \`subscription_id\`, (\`open_key\` IS NULL), \`id\` DESC`,
      [...ids, toMysqlDateTime(since)]
    );
    for (const row of rows) {
      const issue = mapRow(row);
      if (!latest.has(issue.subscriptionId)) latest.set(issue.subscriptionId, issue);
    }
    return latest;
  }

  // Open problems per Stripe account (admin-today), and how many were opened on or before `staleBefore`.
  // `stripeAccounts` null means every account; an empty list means none.
  async countOpenByAccount({ staleBefore, stripeAccounts = null }) {
    const counts = new Map();
    if (Array.isArray(stripeAccounts) && stripeAccounts.length === 0) return counts;
    const where = ['`open_key` IS NOT NULL'];
    const params = [toMysqlDateTime(staleBefore)];
    if (Array.isArray(stripeAccounts)) {
      where.push(`\`stripe_account\` IN (${stripeAccounts.map(() => '?').join(', ')})`);
      params.push(...stripeAccounts);
    }
    const rows = await this.dataSource.query(
      `SELECT \`stripe_account\` AS account, COUNT(*) AS open_count, SUM(\`opened_at\` <= ?) AS stale_count
       FROM \`${TABLE}\` WHERE ${where.join(' AND ')} GROUP BY \`stripe_account\``,
      params
    );
    for (const row of Array.isArray(rows) ? rows : []) {
      counts.set(String(row.account || '').toLowerCase(), { open: Number(row.open_count || 0), stale: Number(row.stale_count || 0) });
    }
    return counts;
  }

  async listByUser(userId) {
    const rows = await this.dataSource.query(
      `SELECT * FROM \`${TABLE}\` WHERE \`user_id\` = ? ORDER BY \`id\``,
      [userId]
    );
    return rows.map(mapRow);
  }

  async deleteByUser(userId) {
    await this.dataSource.query(`DELETE FROM \`${TABLE}\` WHERE \`user_id\` = ?`, [userId]);
  }
}

module.exports = { DeliveryAddressIssuesRepository, mapRow };
