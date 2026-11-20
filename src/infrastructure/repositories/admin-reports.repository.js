const { HttpError } = require('../../core/http-error');

// Stops the query inside MySQL (8.4 on the server), not only the promise in Node.
const QUERY_HINT = '/*+ MAX_EXECUTION_TIME(10000) */';
const ER_QUERY_TIMEOUT = 3024;
const QUEUE_STATUSES = "('active','trialing','past_due')";
const PRODUCTION_STATUSES = ['to_prepare', 'in_production', 'ready', 'blocked'];
const HOUR = (column) => `DATE_FORMAT(${column}, '%Y-%m-%d %H')`;
// Dates leave the database as strings: instants in UTC ISO, calendar dates as YYYY-MM-DD.
const INSTANT = (column) => `DATE_FORMAT(${column}, '%Y-%m-%dT%H:%i:%sZ')`;
const DAY = (column) => `DATE_FORMAT(${column}, '%Y-%m-%d')`;

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

// A SQL fragment with its own placeholders, so a criterion is written once and reused by the
// aggregate query and by the record query of the same indicator.
const cond = (sql, ...params) => ({ sql, params });
const sqlOf = (list, glue) => list.map((item) => item.sql).join(glue);
const paramsOf = (list) => list.flatMap((item) => item.params);
const where = (list) => (list.length ? `WHERE ${sqlOf(list, ' AND ')}` : '');

// Criteria shared by the aggregates and the details. Table aliases are fixed: i invoices, s ledger,
// o onboarding, c cycles, u shipments, it stock items, m stock movements, jt plan line items.
const INVOICE = {
  sameCurrency: (currency) => cond('i.currency = ?', currency),
  otherCurrency: (currency) => cond('i.currency <> ?', currency),
  firstPurchase: cond("i.billing_reason = 'subscription_create'"),
  renewal: cond("(i.billing_reason IS NULL OR i.billing_reason <> 'subscription_create')")
};

const SUBSCRIPTION = {
  active: cond("s.status = 'active'"),
  trialing: cond("s.status = 'trialing'"),
  activeOrTrialing: cond("s.status IN ('active','trialing')"),
  pastDue: cond("s.status = 'past_due'"),
  canceling: cond(`s.cancel_at_period_end = 1 AND s.status IN ${QUEUE_STATUSES}`),
  renewing: (now, in7d) => cond(`s.current_period_end > ? AND s.current_period_end <= ? AND s.status IN ${QUEUE_STATUSES}`, now, in7d),
  activated: cond('s.activated_at IS NOT NULL'),
  newIn: (range) => cond('s.activated_at >= ? AND s.activated_at < ?', range.start, range.end),
  canceledIn: (range) => cond('s.canceled_at >= ? AND s.canceled_at < ?', range.start, range.end),
  activeAt: (start) => cond('s.activated_at < ? AND (s.canceled_at IS NULL OR s.canceled_at >= ?)', start, start),
  approximateNew: cond('s.activated_at_approximate = 1'),
  approximateCanceled: cond('s.canceled_at_approximate = 1')
};

// The unpaid renewal key of the production queue: past due waits on the current period, the rest on the next.
const UNPAID_KEY = "CASE WHEN s.status = 'past_due' THEN s.current_period_start ELSE s.current_period_end END";

const MOVEMENT = {
  produced: "CASE WHEN m.type = 'production' THEN m.quantity END",
  separated: "CASE WHEN m.type = 'separation' THEN ABS(m.quantity) WHEN m.type = 'separation_reversal' THEN -ABS(m.quantity) END",
  adjusted: "CASE WHEN m.type = 'adjustment' THEN m.quantity END",
  // on_hand moves by the signed quantity of every movement.
  balance: 'm.quantity'
};
const MOVEMENT_TYPES = {
  produced: "m.type = 'production'",
  separated: "m.type IN ('separation','separation_reversal')",
  adjusted: "m.type = 'adjustment'"
};

// Every paid cycle counts under exactly one status; an unknown or empty status reads as to_prepare.
const CYCLE_STATUS = "CASE WHEN c.status IN ('in_production','ready','blocked') THEN c.status ELSE 'to_prepare' END";

// Aggregates only: every aggregate query filters by the market's Stripe account or market and never selects
// names, e-mails or addresses. The details list records by internal id; names come from customerNames only.
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
    this.usersTable = options.usersTableName || 'wp_users';
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

  // ---- Scopes: the FROM and WHERE of each source, shared by aggregates and details ----

  invoiceScope({ account, range }) {
    return {
      from: `FROM \`${this.invoicesTable}\` i`,
      where: [cond('i.stripe_account = ?', account), cond("i.invoice_status = 'paid'"), cond('i.issued_at >= ? AND i.issued_at < ?', range.start, range.end)]
    };
  }

  ledgerScope({ account }) {
    return { from: `FROM \`${this.ledgerTable}\` s`, where: [cond('s.stripe_account = ?', account)] };
  }

  linkedSql() {
    return `EXISTS (SELECT 1 FROM \`${this.ledgerTable}\` ls WHERE ls.user_id = o.user_id AND ls.stripe_account = ?)`;
  }

  activatedSql() {
    return `EXISTS (SELECT 1 FROM \`${this.ledgerTable}\` ls WHERE ls.user_id = o.user_id AND ls.stripe_account = ? AND ls.activated_at IS NOT NULL)`;
  }

  checkoutScope({ market, range }) {
    return {
      from: `FROM \`${this.onboardingTable}\` o`,
      where: [cond('o.market = ?', market), cond('o.created_at >= ? AND o.created_at < ?', range.start, range.end)]
    };
  }

  unassignedScope({ range }) {
    return {
      from: `FROM \`${this.onboardingTable}\` o`,
      where: [cond("(o.market IS NULL OR o.market = '')"), cond('o.created_at >= ? AND o.created_at < ?', range.start, range.end)]
    };
  }

  lineItemScope({ account }) {
    return {
      from: `FROM \`${this.ledgerTable}\` s
      JOIN JSON_TABLE(
        CASE WHEN JSON_VALID(s.plan_selection) THEN s.plan_selection ELSE JSON_OBJECT() END,
        '$.catalog_pricing.line_items[*]' COLUMNS (
          flavor VARCHAR(64) PATH '$.flavor',
          flavor_label VARCHAR(255) PATH '$.flavor_label',
          quantity INT PATH '$.quantity',
          pack_size_grams INT PATH '$.pack_size_grams'
        )
      ) jt`,
      where: [cond('s.stripe_account = ?', account), cond(`s.status IN ${QUEUE_STATUSES}`), cond('jt.quantity > 0')]
    };
  }

  cycleScope({ account, from, to }) {
    return {
      from: `FROM \`${this.cyclesTable}\` c
      JOIN \`${this.ledgerTable}\` s ON s.id = c.subscription_id`,
      where: [cond('s.stripe_account = ?', account), cond('c.paid_at IS NOT NULL'), cond('c.delivery_date >= ? AND c.delivery_date <= ?', from, to)]
    };
  }

  lateCond(today) {
    return cond("c.preparation_day < ? AND c.status <> 'ready'", today);
  }

  awaitingScope({ account }) {
    return {
      from: `FROM \`${this.ledgerTable}\` s
      LEFT JOIN \`${this.cyclesTable}\` c ON c.subscription_id = s.id AND c.period_end = ${UNPAID_KEY}`,
      where: [
        cond('s.stripe_account = ?', account),
        cond(`s.status IN ${QUEUE_STATUSES}`),
        cond(`${UNPAID_KEY} IS NOT NULL AND c.paid_at IS NULL`),
        cond("(s.status = 'past_due' OR s.cancel_at_period_end = 0)")
      ]
    };
  }

  shipmentScope({ account, range }) {
    return {
      from: `FROM \`${this.shipmentsTable}\` u
      JOIN \`${this.ledgerTable}\` s ON s.id = u.subscription_id`,
      where: [cond('s.stripe_account = ?', account), cond('u.created_at >= ? AND u.created_at < ?', range.start, range.end)]
    };
  }

  movementScope({ market, range, flavor, grams }) {
    const list = [cond('it.market = ?', market)];
    if (range) list.push(cond('m.created_at >= ? AND m.created_at < ?', range.start, range.end));
    if (flavor != null) list.push(cond('it.flavor_key = ?', flavor));
    if (grams != null) list.push(cond('it.pack_size_grams = ?', grams));
    return {
      from: `FROM \`${this.stockMovementsTable}\` m
      JOIN \`${this.stockItemsTable}\` it ON it.id = m.item_id`,
      where: list
    };
  }

  // ---- Aggregates of the reports ----

  async invoiceTotals({ account, currency, range }) {
    const scope = this.invoiceScope({ account, range });
    const same = INVOICE.sameCurrency(currency);
    const first = [same, INVOICE.firstPurchase];
    const columns = [
      cond(`SUM(CASE WHEN ${same.sql} THEN i.amount_paid_minor ELSE 0 END) AS revenue`, ...same.params),
      cond(`SUM(CASE WHEN ${same.sql} THEN 1 ELSE 0 END) AS invoices`, ...same.params),
      cond(`SUM(CASE WHEN ${sqlOf(first, ' AND ')} THEN i.amount_paid_minor ELSE 0 END) AS firstPurchaseRevenue`, ...paramsOf(first)),
      cond(`SUM(CASE WHEN ${sqlOf(first, ' AND ')} THEN 1 ELSE 0 END) AS firstPurchaseInvoices`, ...paramsOf(first)),
      cond(`SUM(CASE WHEN ${INVOICE.otherCurrency(currency).sql} THEN 1 ELSE 0 END) AS excludedInvoices`, currency)
    ];
    const rows = await this.select(
      `${sqlOf(columns, ',\n        ')}
      ${scope.from}
      ${where(scope.where)}`,
      [...paramsOf(columns), ...paramsOf(scope.where)],
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
    const scope = this.invoiceScope({ account, range });
    const list = [...scope.where, INVOICE.sameCurrency(currency)];
    return this.select(
      `${HOUR('i.issued_at')} AS hour, SUM(i.amount_paid_minor) AS revenue, COUNT(*) AS invoices
      ${scope.from}
      ${where(list)}
      GROUP BY hour`,
      paramsOf(list),
      []
    );
  }

  // Monthly plan price per billable subscription; the MRR sum runs in report-mrr.
  async recurringPrices({ account }) {
    const scope = this.ledgerScope({ account });
    const list = [...scope.where, cond(`s.status IN ${QUEUE_STATUSES}`)];
    return this.select(
      `s.id AS id, s.user_id AS userId, s.status AS status, ${INSTANT('COALESCE(s.activated_at, s.created_at)')} AS date,
        CASE WHEN JSON_VALID(s.plan_selection)
          THEN JSON_UNQUOTE(JSON_EXTRACT(s.plan_selection, '$.catalog_pricing.subtotal')) END AS subtotal
      ${scope.from}
      ${where(list)}
      ORDER BY s.id`,
      paramsOf(list),
      []
    );
  }

  async subscriptionSnapshot({ account, now, in7d }) {
    const scope = this.ledgerScope({ account });
    const renewing = SUBSCRIPTION.renewing(now, in7d);
    const rows = await this.select(
      `SUM(CASE WHEN ${SUBSCRIPTION.active.sql} THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN ${SUBSCRIPTION.trialing.sql} THEN 1 ELSE 0 END) AS trialing,
        SUM(CASE WHEN ${SUBSCRIPTION.canceling.sql} THEN 1 ELSE 0 END) AS canceling,
        SUM(CASE WHEN ${SUBSCRIPTION.pastDue.sql} THEN 1 ELSE 0 END) AS pastDue,
        SUM(CASE WHEN ${renewing.sql} THEN 1 ELSE 0 END) AS renewing7d
      ${scope.from}
      ${where(scope.where)}`,
      [...renewing.params, ...paramsOf(scope.where)],
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
    const scope = this.ledgerScope({ account });
    const list = [...scope.where, SUBSCRIPTION.activated];
    const sum = (alias, ...parts) => cond(`SUM(CASE WHEN ${sqlOf(parts, ' AND ')} THEN 1 ELSE 0 END) AS ${alias}`, ...paramsOf(parts));
    const columns = [
      sum('newCount', SUBSCRIPTION.newIn(range)),
      sum('approximateNew', SUBSCRIPTION.newIn(range), SUBSCRIPTION.approximateNew),
      sum('canceled', SUBSCRIPTION.canceledIn(range)),
      sum('approximateCanceled', SUBSCRIPTION.canceledIn(range), SUBSCRIPTION.approximateCanceled),
      sum('activeAtStart', SUBSCRIPTION.activeAt(range.start)),
      sum('churned', SUBSCRIPTION.activeAt(range.start), SUBSCRIPTION.canceledIn(range))
    ];
    const rows = await this.select(
      `${sqlOf(columns, ',\n        ')}
      ${scope.from}
      ${where(list)}`,
      [...paramsOf(columns), ...paramsOf(list)],
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
    const scope = this.ledgerScope({ account });
    const created = [...scope.where, SUBSCRIPTION.newIn(range)];
    const ended = [...scope.where, SUBSCRIPTION.activated, SUBSCRIPTION.canceledIn(range)];
    return this.select(
      `hour, SUM(kind = 'new') AS newCount, SUM(kind = 'canceled') AS canceled FROM (
        SELECT ${HOUR('s.activated_at')} AS hour, 'new' AS kind ${scope.from} ${where(created)}
        UNION ALL
        SELECT ${HOUR('s.canceled_at')} AS hour, 'canceled' AS kind ${scope.from} ${where(ended)}
      ) events GROUP BY hour`,
      [...paramsOf(created), ...paramsOf(ended)],
      []
    );
  }

  async acquisitionTotals({ market, account, range }) {
    const scope = this.checkoutScope({ market, range });
    const rows = await this.select(
      `COUNT(*) AS started,
        SUM(${this.linkedSql()}) AS linked,
        SUM(${this.activatedSql()}) AS activated
      ${scope.from}
      ${where(scope.where)}`,
      [account, account, ...paramsOf(scope.where)],
      []
    );
    const row = rows[0] || {};
    return { started: number(row.started), linked: number(row.linked), activated: number(row.activated) };
  }

  // Checkouts with no market belong to no report; admins see how many so they do not vanish silently.
  async unassignedCheckouts({ range }) {
    const scope = this.unassignedScope({ range });
    const rows = await this.select(
      `COUNT(*) AS unassigned
      ${scope.from}
      ${where(scope.where)}`,
      paramsOf(scope.where),
      []
    );
    return number(rows[0] && rows[0].unassigned);
  }

  async acquisitionSeries({ market, range }) {
    const scope = this.checkoutScope({ market, range });
    return this.select(
      `${HOUR('o.created_at')} AS hour, COUNT(*) AS started
      ${scope.from}
      ${where(scope.where)}
      GROUP BY hour`,
      paramsOf(scope.where),
      []
    );
  }

  async mixByRecipe({ account }) {
    const scope = this.lineItemScope({ account });
    return this.select(
      `jt.flavor AS flavor, MAX(jt.flavor_label) AS flavorLabel, SUM(jt.quantity) AS packs, COUNT(DISTINCT s.id) AS subscriptions
      ${scope.from}
      ${where(scope.where)}
      GROUP BY jt.flavor ORDER BY packs DESC`,
      paramsOf(scope.where),
      []
    );
  }

  async mixByPackSize({ account }) {
    const scope = this.lineItemScope({ account });
    return this.select(
      `jt.pack_size_grams AS grams, SUM(jt.quantity) AS packs, COUNT(DISTINCT s.id) AS subscriptions
      ${scope.from}
      ${where(scope.where)}
      GROUP BY jt.pack_size_grams ORDER BY grams`,
      paramsOf(scope.where),
      []
    );
  }

  // Paid cycles by delivery date (a local calendar date); late is judged against the market's today.
  async cyclesByStatus({ account, from, to, today }) {
    const scope = this.cycleScope({ account, from, to });
    const late = this.lateCond(today);
    const rows = await this.select(
      `${CYCLE_STATUS} AS status, COUNT(*) AS cycles,
        SUM(CASE WHEN ${late.sql} THEN 1 ELSE 0 END) AS late
      ${scope.from}
      ${where(scope.where)}
      GROUP BY status`,
      [...late.params, ...paramsOf(scope.where)],
      []
    );
    const byStatus = Object.fromEntries(PRODUCTION_STATUSES.map((status) => [status, 0]));
    let lateCount = 0;
    for (const row of rows) {
      const status = PRODUCTION_STATUSES.includes(row.status) ? row.status : 'to_prepare';
      byStatus[status] += number(row.cycles);
      lateCount += number(row.late);
    }
    return { byStatus, late: lateCount };
  }

  // Renewals in the queue that are still waiting for payment, as the production queue lists them.
  async awaitingPayment({ account }) {
    const scope = this.awaitingScope({ account });
    const rows = await this.select(
      `COUNT(*) AS awaiting
      ${scope.from}
      ${where(scope.where)}`,
      paramsOf(scope.where),
      []
    );
    return number(rows[0] && rows[0].awaiting);
  }

  async shipmentsByStatus({ account, range }) {
    const scope = this.shipmentScope({ account, range });
    return this.select(
      `u.status AS status, COUNT(*) AS shipments
      ${scope.from}
      ${where(scope.where)}
      GROUP BY u.status`,
      paramsOf(scope.where),
      []
    );
  }

  async stockRows({ market, range }) {
    return this.select(
      `it.flavor_key AS flavorKey, it.pack_size_grams AS grams, it.on_hand AS onHand, it.min_level AS minLevel,
        COALESCE(SUM(${MOVEMENT.produced}), 0) AS produced,
        COALESCE(SUM(${MOVEMENT.separated}), 0) AS separated,
        COALESCE(SUM(${MOVEMENT.adjusted}), 0) AS adjusted
      FROM \`${this.stockItemsTable}\` it
      LEFT JOIN \`${this.stockMovementsTable}\` m ON m.item_id = it.id AND m.created_at >= ? AND m.created_at < ?
      WHERE it.market = ?
      GROUP BY it.id, it.flavor_key, it.pack_size_grams, it.on_hand, it.min_level
      ORDER BY it.flavor_key, it.pack_size_grams`,
      [range.start, range.end, market],
      []
    );
  }

  // ---- Details: the records behind one figure ----

  // The record query of a source: its columns, the measures each record adds to the figure, and the scope.
  detailSource(name, args = {}) {
    switch (name) {
      case 'invoices': {
        const scope = this.invoiceScope(args);
        const extra = {
          paid: [INVOICE.sameCurrency(args.currency)],
          firstPurchase: [INVOICE.sameCurrency(args.currency), INVOICE.firstPurchase],
          renewal: [INVOICE.sameCurrency(args.currency), INVOICE.renewal],
          otherCurrency: [INVOICE.otherCurrency(args.currency)]
        }[args.variant || 'paid'];
        return {
          ...scope,
          where: [...scope.where, ...extra],
          columns: [
            'i.id AS id', 'i.invoice_number AS invoiceNumber', `${INSTANT('i.issued_at')} AS date`,
            "COALESCE(i.billing_reason, '') AS groupKey", 'i.amount_paid_minor AS amount', 'i.currency AS currency', 'i.user_id AS userId',
            `(SELECT ls.id FROM \`${this.ledgerTable}\` ls WHERE ls.stripe_subscription_id COLLATE utf8mb4_unicode_ci = i.stripe_subscription_id COLLATE utf8mb4_unicode_ci ORDER BY ls.id LIMIT 1) AS subscriptionId`
          ],
          measures: { amount: cond('i.amount_paid_minor'), one: cond('1') },
          order: 'date, id'
        };
      }
      case 'subscriptions': {
        const scope = this.ledgerScope(args);
        const range = args.range;
        const variants = {
          active: { list: [SUBSCRIPTION.active], date: 'COALESCE(s.activated_at, s.created_at)' },
          trialing: { list: [SUBSCRIPTION.trialing], date: 'COALESCE(s.activated_at, s.created_at)' },
          activeOrTrialing: { list: [SUBSCRIPTION.activeOrTrialing], date: 'COALESCE(s.activated_at, s.created_at)' },
          pastDue: { list: [SUBSCRIPTION.pastDue], date: 'COALESCE(s.activated_at, s.created_at)' },
          canceling: { list: [SUBSCRIPTION.canceling], date: 's.current_period_end' },
          renewing7d: { list: [() => SUBSCRIPTION.renewing(args.now, args.in7d)], date: 's.current_period_end' },
          new: { list: [SUBSCRIPTION.activated, () => SUBSCRIPTION.newIn(range)], date: 's.activated_at' },
          approximateNew: { list: [SUBSCRIPTION.activated, () => SUBSCRIPTION.newIn(range), SUBSCRIPTION.approximateNew], date: 's.activated_at' },
          canceled: { list: [SUBSCRIPTION.activated, () => SUBSCRIPTION.canceledIn(range)], date: 's.canceled_at' },
          approximateCanceled: { list: [SUBSCRIPTION.activated, () => SUBSCRIPTION.canceledIn(range), SUBSCRIPTION.approximateCanceled], date: 's.canceled_at' },
          activeAtStart: { list: [SUBSCRIPTION.activated, () => SUBSCRIPTION.activeAt(range.start)], date: 's.activated_at' }
        };
        const variant = variants[args.variant];
        const churned = range ? SUBSCRIPTION.canceledIn(range) : cond('0');
        return {
          from: scope.from,
          where: [...scope.where, ...variant.list.map((item) => (typeof item === 'function' ? item() : item))],
          columns: [
            's.id AS id', `${INSTANT(variant.date)} AS date`, 's.status AS groupKey', 's.user_id AS userId', 's.id AS subscriptionId',
            `${INSTANT('s.activated_at')} AS activatedAt`, `${INSTANT('s.canceled_at')} AS canceledAt`, `${INSTANT('s.current_period_end')} AS currentPeriodEnd`,
            's.cancel_at_period_end AS cancelAtPeriodEnd', 's.activated_at_approximate AS activatedApproximate', 's.canceled_at_approximate AS canceledApproximate'
          ],
          measures: { one: cond('1'), churned: cond(`CASE WHEN ${churned.sql} THEN 1 ELSE 0 END`, ...churned.params) },
          order: 'date, id'
        };
      }
      case 'checkouts': {
        const scope = args.variant === 'unassigned' ? this.unassignedScope(args) : this.checkoutScope(args);
        const linked = cond(this.linkedSql(), args.account);
        const activated = cond(this.activatedSql(), args.account);
        const extra = { started: [], linked: [linked], activated: [activated], unassigned: [] }[args.variant];
        return {
          ...scope,
          where: [...scope.where, ...extra],
          columns: [
            'o.user_id AS id', `${INSTANT('o.created_at')} AS date`, 'o.user_id AS userId',
            cond(`CASE WHEN ${activated.sql} THEN 'activated' WHEN ${linked.sql} THEN 'linked' ELSE 'started' END AS groupKey`, ...activated.params, ...linked.params)
          ],
          measures: {
            one: cond('1'),
            linked: cond(`CASE WHEN ${linked.sql} THEN 1 ELSE 0 END`, ...linked.params),
            activated: cond(`CASE WHEN ${activated.sql} THEN 1 ELSE 0 END`, ...activated.params)
          },
          order: 'date, id'
        };
      }
      case 'lineItems': {
        // One record per subscription: the line items of the recipe or pack size, summed.
        const scope = this.lineItemScope(args);
        const extra = [];
        if (args.flavor != null) extra.push(cond('jt.flavor = ?', args.flavor));
        if (args.grams != null) extra.push(cond('jt.pack_size_grams = ?', args.grams));
        const match = args.match || {};
        const matchCond = match.flavor != null ? cond('jt.flavor = ?', match.flavor) : match.grams != null ? cond('jt.pack_size_grams = ?', match.grams) : null;
        return {
          ...scope,
          where: [...scope.where, ...extra],
          columns: [
            's.id AS id', `${INSTANT('COALESCE(MIN(s.activated_at), MIN(s.created_at))')} AS date`, 'MIN(s.status) AS groupKey',
            'MIN(s.user_id) AS userId', 's.id AS subscriptionId',
            "GROUP_CONCAT(CONCAT(jt.flavor, ' · ', jt.pack_size_grams, ' g × ', jt.quantity) ORDER BY jt.flavor, jt.pack_size_grams SEPARATOR '; ') AS items"
          ],
          measures: {
            one: cond('1'),
            packs: cond('SUM(jt.quantity)'),
            matchPacks: matchCond ? cond(`SUM(CASE WHEN ${matchCond.sql} THEN jt.quantity ELSE 0 END)`, ...matchCond.params) : cond('SUM(jt.quantity)')
          },
          groupBy: 's.id',
          order: 'date, id'
        };
      }
      case 'cycles': {
        const scope = this.cycleScope(args);
        const late = this.lateCond(args.today);
        const extra = [];
        if (args.status) extra.push(cond(`${CYCLE_STATUS} = ?`, args.status));
        if (args.late) extra.push(late);
        return {
          ...scope,
          where: [...scope.where, ...extra],
          columns: [
            'c.id AS id', `${DAY('c.delivery_date')} AS date`, `${CYCLE_STATUS} AS groupKey`, `${DAY('c.preparation_day')} AS preparationDay`,
            `${DAY('c.delivery_date')} AS deliveryDate`, `${INSTANT('c.paid_at')} AS paidAt`, 's.id AS subscriptionId', 's.user_id AS userId',
            cond(`CASE WHEN ${late.sql} THEN 1 ELSE 0 END AS late`, ...late.params)
          ],
          measures: { one: cond('1') },
          order: 'date, id'
        };
      }
      case 'awaiting': {
        const scope = this.awaitingScope(args);
        return {
          ...scope,
          columns: ['s.id AS id', `${INSTANT(UNPAID_KEY)} AS date`, 's.status AS groupKey', 's.user_id AS userId', 's.id AS subscriptionId'],
          measures: { one: cond('1') },
          order: 'date, id'
        };
      }
      case 'shipments': {
        const scope = this.shipmentScope(args);
        const extra = {
          total: [cond("(u.status IS NULL OR u.status <> 'voided')")],
          voided: [cond("u.status = 'voided'")],
          status: [cond('u.status = ?', args.status)]
        }[args.variant || 'total'];
        return {
          ...scope,
          where: [...scope.where, ...extra],
          columns: [
            'u.id AS id', `${INSTANT('u.created_at')} AS date`, "COALESCE(u.status, '') AS groupKey", 'u.tracking_number AS trackingNumber',
            's.id AS subscriptionId', 's.user_id AS userId'
          ],
          measures: { one: cond('1') },
          order: 'date, id'
        };
      }
      case 'movements': {
        const scope = this.movementScope(args);
        const kind = args.kind || 'balance';
        const extra = MOVEMENT_TYPES[kind] ? [cond(MOVEMENT_TYPES[kind])] : [];
        return {
          ...scope,
          where: [...scope.where, ...extra],
          columns: [
            'm.id AS id', `${INSTANT('m.created_at')} AS date`, 'm.type AS groupKey', 'm.quantity AS quantity', 'm.reason AS reason',
            'it.flavor_key AS flavorKey', 'it.pack_size_grams AS grams', 'm.subscription_id AS subscriptionId', 'm.production_cycle_id AS cycleId'
          ],
          measures: { effect: cond(`COALESCE(${MOVEMENT[kind]}, 0)`) },
          order: 'date, id'
        };
      }
      default:
        throw new Error(`Unknown report detail source: ${name}`);
    }
  }

  // The inner SELECT of a source with the measures named as contribution / numerator / denominator.
  detailInner(source, measures) {
    const columns = source.columns.map((item) => (typeof item === 'string' ? cond(item) : item));
    const measured = Object.entries(measures).map(([alias, key]) => {
      const measure = source.measures[key];
      return cond(`${measure.sql} AS ${alias}`, ...measure.params);
    });
    const all = [...columns, ...measured];
    return {
      sql: `SELECT ${sqlOf(all, ', ')}
      ${source.from}
      ${where(source.where)}${source.groupBy ? `\n      GROUP BY ${source.groupBy}` : ''}`,
      params: [...paramsOf(all), ...paramsOf(source.where)]
    };
  }

  async detailRecords(name, args, measures, { limit, offset }) {
    const source = this.detailSource(name, args);
    const inner = this.detailInner(source, measures);
    // The outer SELECT keeps the hint; the inner one is the record set, ordered and paged outside.
    return this.select(
      `t.* FROM (${inner.sql}) t ORDER BY ${source.order.split(', ').map((column) => `t.${column}`).join(', ')} LIMIT ? OFFSET ?`,
      [...inner.params, Number(limit), Number(offset)],
      []
    );
  }

  // Count and sums over every record of the figure, not only the page, plus the subtotals per group.
  async detailTotals(name, args, measures) {
    const source = this.detailSource(name, args);
    const inner = this.detailInner(source, measures);
    const sums = Object.keys(measures).map((alias) => `COALESCE(SUM(t.${alias}), 0) AS ${alias}`).join(', ');
    const [totals, groups] = await Promise.all([
      this.select(`COUNT(*) AS count${sums ? `, ${sums}` : ''} FROM (${inner.sql}) t`, inner.params, []),
      this.select(`t.groupKey AS groupKey, COUNT(*) AS count${sums ? `, ${sums}` : ''} FROM (${inner.sql}) t GROUP BY t.groupKey ORDER BY t.groupKey`, inner.params, [])
    ]);
    const parse = (row = {}) => ({
      count: number(row.count),
      ...Object.fromEntries(Object.keys(measures).map((alias) => [alias, number(row[alias])]))
    });
    return { totals: parse(totals[0]), groups: groups.map((row) => ({ key: row.groupKey == null ? '' : String(row.groupKey), ...parse(row) })) };
  }

  // Names of the customers on one page of details; asked only for sessions allowed to see subscribers.
  async customerNames(userIds = []) {
    const ids = [...new Set(userIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
    if (!ids.length) {
      return {};
    }
    const rows = await this.select(
      `u.ID AS id, u.display_name AS name FROM \`${this.usersTable}\` u WHERE u.ID IN (${ids.map(() => '?').join(', ')})`,
      ids,
      []
    );
    return Object.fromEntries(rows.map((row) => [Number(row.id), row.name || '']));
  }
}

module.exports = {
  AdminReportsRepository,
  PRODUCTION_STATUSES,
  QUERY_HINT
};
