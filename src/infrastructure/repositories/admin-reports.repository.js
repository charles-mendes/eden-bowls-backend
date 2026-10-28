const { HttpError } = require('../../core/http-error');

// Stops the query inside MySQL (8.4 on the server), not only the promise in Node.
const QUERY_HINT = '/*+ MAX_EXECUTION_TIME(10000) */';
const ER_QUERY_TIMEOUT = 3024;
const QUEUE_STATUSES = "('active','trialing','past_due')";
const PRODUCTION_STATUSES = ['to_prepare', 'in_production', 'ready', 'blocked'];
const HOUR = (column) => `DATE_FORMAT(${column}, '%Y-%m-%d %H')`;

function isMissingTableError(error) {
  const message = String(error && error.message ? error.message : '');
  return Boolean(error && (error.code === 'ER_NO_SUCH_TABLE' || error.errno === 1146 || /doesn't exist/i.test(message)));
}

function isTimeoutError(error) {
  return Boolean(error && (error.errno === ER_QUERY_TIMEOUT || error.code === 'ER_QUERY_TIMEOUT'));
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Aggregates only: every query filters by the market's Stripe account or market and never selects
// names, e-mails or addresses.
class AdminReportsRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.ledgerTable = options.ledgerTableName || 'stripe_subscriptions';
    this.invoicesTable = options.invoicesTableName || 'customer_invoices';
    this.onboardingTable = options.onboardingTableName || 'onboarding_user_state';
    this.cyclesTable = options.cyclesTableName || 'subscription_production_cycles';
    this.shipmentsTable = options.shipmentsTableName || 'ups_shipments';
    this.stockItemsTable = options.stockItemsTableName || 'pack_stock_items';
    this.stockMovementsTable = options.stockMovementsTableName || 'pack_stock_movements';
  }

  async select(sql, params, empty) {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database is not available.');
    }
    try {
      return await this.dataSource.query(`SELECT ${QUERY_HINT} ${sql}`, params);
    } catch (error) {
      if (isTimeoutError(error)) {
        throw new HttpError(503, 'The report took too long. Try a shorter period.', { code: 'report_timeout' });
      }
      if (isMissingTableError(error)) {
        return empty;
      }
      throw error;
    }
  }

  async invoiceTotals({ account, currency, range }) {
    const rows = await this.select(
      `SUM(CASE WHEN currency = ? THEN amount_paid_minor ELSE 0 END) AS revenue,
        SUM(CASE WHEN currency = ? THEN 1 ELSE 0 END) AS invoices,
        SUM(CASE WHEN currency = ? AND billing_reason = 'subscription_create' THEN amount_paid_minor ELSE 0 END) AS firstPurchaseRevenue,
        SUM(CASE WHEN currency = ? AND billing_reason = 'subscription_create' THEN 1 ELSE 0 END) AS firstPurchaseInvoices,
        SUM(CASE WHEN currency <> ? THEN 1 ELSE 0 END) AS excludedInvoices
      FROM \`${this.invoicesTable}\`
      WHERE stripe_account = ? AND invoice_status = 'paid' AND issued_at >= ? AND issued_at < ?`,
      [currency, currency, currency, currency, currency, account, range.start, range.end],
      []
    );
    const row = rows[0] || {};
    return {
      revenue: number(row.revenue),
      invoices: number(row.invoices),
      firstPurchaseRevenue: number(row.firstPurchaseRevenue),
      firstPurchaseInvoices: number(row.firstPurchaseInvoices),
      excludedInvoices: number(row.excludedInvoices)
    };
  }

  async invoiceSeries({ account, currency, range }) {
    return this.select(
      `${HOUR('issued_at')} AS hour, SUM(amount_paid_minor) AS revenue, COUNT(*) AS invoices
      FROM \`${this.invoicesTable}\`
      WHERE stripe_account = ? AND currency = ? AND invoice_status = 'paid' AND issued_at >= ? AND issued_at < ?
      GROUP BY hour`,
      [account, currency, range.start, range.end],
      []
    );
  }

  // Monthly plan price per billable subscription; the MRR sum runs in report-mrr.
  async recurringPrices({ account }) {
    return this.select(
      `status,
        CASE WHEN JSON_VALID(plan_selection)
          THEN JSON_UNQUOTE(JSON_EXTRACT(plan_selection, '$.catalog_pricing.subtotal')) END AS subtotal
      FROM \`${this.ledgerTable}\`
      WHERE stripe_account = ? AND status IN ('active','trialing','past_due')`,
      [account],
      []
    );
  }

  async subscriptionSnapshot({ account, now, in7d }) {
    const rows = await this.select(
      `SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN status = 'trialing' THEN 1 ELSE 0 END) AS trialing,
        SUM(CASE WHEN cancel_at_period_end = 1 AND status IN ${QUEUE_STATUSES} THEN 1 ELSE 0 END) AS canceling,
        SUM(CASE WHEN status = 'past_due' THEN 1 ELSE 0 END) AS pastDue,
        SUM(CASE WHEN current_period_end > ? AND current_period_end <= ? AND status IN ${QUEUE_STATUSES} THEN 1 ELSE 0 END) AS renewing7d
      FROM \`${this.ledgerTable}\`
      WHERE stripe_account = ?`,
      [now, in7d, account],
      []
    );
    const row = rows[0] || {};
    return {
      active: number(row.active),
      trialing: number(row.trialing),
      canceling: number(row.canceling),
      pastDue: number(row.pastDue),
      renewing7d: number(row.renewing7d)
    };
  }

  // New, canceled and the churn cohort of one window. Rows that never activated count nowhere.
  async subscriptionPeriod({ account, range }) {
    const rows = await this.select(
      `SUM(CASE WHEN activated_at >= ? AND activated_at < ? THEN 1 ELSE 0 END) AS newCount,
        SUM(CASE WHEN activated_at >= ? AND activated_at < ? AND activated_at_approximate = 1 THEN 1 ELSE 0 END) AS approximateNew,
        SUM(CASE WHEN canceled_at >= ? AND canceled_at < ? THEN 1 ELSE 0 END) AS canceled,
        SUM(CASE WHEN canceled_at >= ? AND canceled_at < ? AND canceled_at_approximate = 1 THEN 1 ELSE 0 END) AS approximateCanceled,
        SUM(CASE WHEN activated_at < ? AND (canceled_at IS NULL OR canceled_at >= ?) THEN 1 ELSE 0 END) AS activeAtStart,
        SUM(CASE WHEN activated_at < ? AND canceled_at >= ? AND canceled_at < ? THEN 1 ELSE 0 END) AS churned
      FROM \`${this.ledgerTable}\`
      WHERE stripe_account = ? AND activated_at IS NOT NULL`,
      [
        range.start, range.end,
        range.start, range.end,
        range.start, range.end,
        range.start, range.end,
        range.start, range.start,
        range.start, range.start, range.end,
        account
      ],
      []
    );
    const row = rows[0] || {};
    return {
      newCount: number(row.newCount),
      approximateNew: number(row.approximateNew),
      canceled: number(row.canceled),
      approximateCanceled: number(row.approximateCanceled),
      activeAtStart: number(row.activeAtStart),
      churned: number(row.churned)
    };
  }

  async subscriptionSeries({ account, range }) {
    return this.select(
      `hour, SUM(kind = 'new') AS newCount, SUM(kind = 'canceled') AS canceled FROM (
        SELECT ${HOUR('activated_at')} AS hour, 'new' AS kind FROM \`${this.ledgerTable}\`
          WHERE stripe_account = ? AND activated_at >= ? AND activated_at < ?
        UNION ALL
        SELECT ${HOUR('canceled_at')} AS hour, 'canceled' AS kind FROM \`${this.ledgerTable}\`
          WHERE stripe_account = ? AND activated_at IS NOT NULL AND canceled_at >= ? AND canceled_at < ?
      ) events GROUP BY hour`,
      [account, range.start, range.end, account, range.start, range.end],
      []
    );
  }

  async acquisitionTotals({ market, account, range }) {
    const rows = await this.select(
      `COUNT(*) AS started,
        SUM(EXISTS (SELECT 1 FROM \`${this.ledgerTable}\` s WHERE s.user_id = o.user_id AND s.stripe_account = ?)) AS linked,
        SUM(EXISTS (SELECT 1 FROM \`${this.ledgerTable}\` s WHERE s.user_id = o.user_id AND s.stripe_account = ? AND s.activated_at IS NOT NULL)) AS activated
      FROM \`${this.onboardingTable}\` o
      WHERE o.market = ? AND o.created_at >= ? AND o.created_at < ?`,
      [account, account, market, range.start, range.end],
      []
    );
    const row = rows[0] || {};
    return { started: number(row.started), linked: number(row.linked), activated: number(row.activated) };
  }

  // Checkouts with no market belong to no report; admins see how many so they do not vanish silently.
  async unassignedCheckouts({ range }) {
    const rows = await this.select(
      `COUNT(*) AS unassigned
      FROM \`${this.onboardingTable}\`
      WHERE (market IS NULL OR market = '') AND created_at >= ? AND created_at < ?`,
      [range.start, range.end],
      []
    );
    return number(rows[0] && rows[0].unassigned);
  }

  async acquisitionSeries({ market, range }) {
    return this.select(
      `${HOUR('created_at')} AS hour, COUNT(*) AS started
      FROM \`${this.onboardingTable}\`
      WHERE market = ? AND created_at >= ? AND created_at < ?
      GROUP BY hour`,
      [market, range.start, range.end],
      []
    );
  }

  lineItemsSql() {
    return `FROM \`${this.ledgerTable}\` s
      JOIN JSON_TABLE(
        CASE WHEN JSON_VALID(s.plan_selection) THEN s.plan_selection ELSE JSON_OBJECT() END,
        '$.catalog_pricing.line_items[*]' COLUMNS (
          flavor VARCHAR(64) PATH '$.flavor',
          flavor_label VARCHAR(255) PATH '$.flavor_label',
          quantity INT PATH '$.quantity',
          pack_size_grams INT PATH '$.pack_size_grams'
        )
      ) jt
      WHERE s.stripe_account = ? AND s.status IN ${QUEUE_STATUSES} AND jt.quantity > 0`;
  }

  async mixByRecipe({ account }) {
    return this.select(
      `jt.flavor AS flavor, MAX(jt.flavor_label) AS flavorLabel, SUM(jt.quantity) AS packs, COUNT(DISTINCT s.id) AS subscriptions
      ${this.lineItemsSql()}
      GROUP BY jt.flavor ORDER BY packs DESC`,
      [account],
      []
    );
  }

  async mixByPackSize({ account }) {
    return this.select(
      `jt.pack_size_grams AS grams, SUM(jt.quantity) AS packs, COUNT(DISTINCT s.id) AS subscriptions
      ${this.lineItemsSql()}
      GROUP BY jt.pack_size_grams ORDER BY grams`,
      [account],
      []
    );
  }

  // Paid cycles by delivery date (a local calendar date); late is judged against the market's today.
  async cyclesByStatus({ account, from, to, today }) {
    const rows = await this.select(
      `c.status AS status, COUNT(*) AS cycles,
        SUM(CASE WHEN c.preparation_day < ? AND c.status <> 'ready' THEN 1 ELSE 0 END) AS late
      FROM \`${this.cyclesTable}\` c
      JOIN \`${this.ledgerTable}\` s ON s.id = c.subscription_id
      WHERE s.stripe_account = ? AND c.paid_at IS NOT NULL AND c.delivery_date >= ? AND c.delivery_date <= ?
      GROUP BY c.status`,
      [today, account, from, to],
      []
    );
    const byStatus = Object.fromEntries(PRODUCTION_STATUSES.map((status) => [status, 0]));
    let late = 0;
    for (const row of rows) {
      const status = PRODUCTION_STATUSES.includes(row.status) ? row.status : 'to_prepare';
      byStatus[status] += number(row.cycles);
      late += number(row.late);
    }
    return { byStatus, late };
  }

  // Renewals in the queue that are still waiting for payment, as the production queue lists them.
  async awaitingPayment({ account }) {
    const unpaidKey = "CASE WHEN s.status = 'past_due' THEN s.current_period_start ELSE s.current_period_end END";
    const rows = await this.select(
      `COUNT(*) AS awaiting
      FROM \`${this.ledgerTable}\` s
      LEFT JOIN \`${this.cyclesTable}\` c ON c.subscription_id = s.id AND c.period_end = ${unpaidKey}
      WHERE s.stripe_account = ? AND s.status IN ${QUEUE_STATUSES}
        AND ${unpaidKey} IS NOT NULL AND c.paid_at IS NULL
        AND (s.status = 'past_due' OR s.cancel_at_period_end = 0)`,
      [account],
      []
    );
    return number(rows[0] && rows[0].awaiting);
  }

  async shipmentsByStatus({ account, range }) {
    return this.select(
      `u.status AS status, COUNT(*) AS shipments
      FROM \`${this.shipmentsTable}\` u
      JOIN \`${this.ledgerTable}\` s ON s.id = u.subscription_id
      WHERE s.stripe_account = ? AND u.created_at >= ? AND u.created_at < ?
      GROUP BY u.status`,
      [account, range.start, range.end],
      []
    );
  }

  async stockRows({ market, range }) {
    return this.select(
      `i.flavor_key AS flavorKey, i.pack_size_grams AS grams, i.on_hand AS onHand, i.min_level AS minLevel,
        COALESCE(SUM(CASE WHEN m.type = 'production' THEN m.quantity END), 0) AS produced,
        COALESCE(SUM(CASE WHEN m.type = 'separation' THEN ABS(m.quantity) WHEN m.type = 'separation_reversal' THEN -ABS(m.quantity) END), 0) AS separated,
        COALESCE(SUM(CASE WHEN m.type = 'adjustment' THEN m.quantity END), 0) AS adjusted
      FROM \`${this.stockItemsTable}\` i
      LEFT JOIN \`${this.stockMovementsTable}\` m ON m.item_id = i.id AND m.created_at >= ? AND m.created_at < ?
      WHERE i.market = ?
      GROUP BY i.id, i.flavor_key, i.pack_size_grams, i.on_hand, i.min_level
      ORDER BY i.flavor_key, i.pack_size_grams`,
      [range.start, range.end, market],
      []
    );
  }
}

module.exports = {
  AdminReportsRepository,
  PRODUCTION_STATUSES,
  QUERY_HINT
};
