const { DateTime } = require('luxon');
const { HttpError } = require('../core/http-error');
const { canAccessMarket, constrainMarketQuery, shouldEnforceMarketScope } = require('../core/admin-market-scope');
const { extractSubscriptionIdFromInvoice, parseJsonColumn } = require('../core/stripe-subscription-map');
const { isChargedDeliveryInvoice } = require('../core/contract-deliveries');
const { invoiceReadinessReasons } = require('../core/dispatch-readiness');
const { parseCourierDetails, parseFailureKind, parseFailureReason } = require('../core/courier-fields');
const { presentProductionQueueItem, recipientDisplayName, accountNameOf, shownName } = require('../core/production-queue-presenter');
const { shipmentMarket } = require('../core/shipment-market');
const { brazilAddressIssues } = require('../core/delivery-address-check');
const { resolveDeliveryRange, dayAfter } = require('../core/delivery-range');
const { checkoutShippingOf } = require('../core/checkout-shipping');

const TIMEZONE = 'America/Sao_Paulo';
const DISPATCH_FLOOR_DAYS = 30;
const DELIVERED_WINDOW_DAYS = 7;
const QUEUE_LIMIT = 200;
// Today warns about a delivery still on the road this long after it left.
const LONG_ON_THE_ROAD_HOURS = 24;
const ACTIVE = new Set(['out_for_delivery', 'delivered']);

// Rows under to dispatch (no delivery) and failed can be dispatched; the others already left.
// The date a queue cycle is sorted and filtered by, as the ledger query does: the delivery date, or the period end.
function cycleDeliveryKey(cycle) {
  if (!cycle) return null;
  if (cycle.deliveryDate) return cycle.deliveryDate;
  const end = cycle.cyclePeriodEnd ? new Date(cycle.cyclePeriodEnd) : null;
  return end && !Number.isNaN(end.getTime()) ? end.toISOString().slice(0, 10) : null;
}

function groupCanDispatch(row) {
  return !row || row.status === 'failed';
}

function finalError() {
  return new HttpError(409, 'This courier delivery is already closed.', { code: 'courier_delivery_final' });
}

function marketExceptionError() {
  return new HttpError(422, 'The Stripe account and the address country of this subscription do not match, so it ships from no market.', { code: 'shipment_market_exception' });
}

function invalidField(field, message) {
  return new HttpError(422, message, { code: 'invalid_courier_field', field });
}

function addressOf(value) {
  return parseJsonColumn(value) || {};
}

function countryOf(address) {
  return String(address.country || '').trim().toUpperCase();
}

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(value)) ? '' : 'Z'));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toTime(value) {
  const iso = toIso(value);
  return iso ? new Date(iso).getTime() : NaN;
}

// Records by hand the courier delivery of a paid Brazil cycle (courier-delivery): dispatch, the final
// statuses, edits, the admin queue, the audit entries and the two letters.
const NFE_AUTHORIZED = 'authorized';

// simplify-brazil-dispatch: "A despachar" opens on ready cycles; `todos` brings back every paid cycle.
const PREPARO_VALUES = new Set(['prontos', 'todos']);

function parsePreparo(value) {
  if (value === undefined || value === null || value === '') return 'prontos';
  if (typeof value === 'string' && PREPARO_VALUES.has(value)) return value;
  throw new HttpError(400, 'preparo must be prontos or todos.', { code: 'invalid_preparo' });
}

// The freight the customer paid at checkout, for the dispatch dialog.
function customerShippingOf(shipping) {
  const value = checkoutShippingOf(shipping);
  if (!value) return null;
  const { distanceKm, ...rest } = value;
  return { ...rest, distance_km: distanceKm };
}

class CourierDeliveryService {
  constructor(options = {}) {
    this.repository = options.repository || null;
    this.adminBillingService = options.adminBillingService || null;
    this.addressIssueService = options.addressIssueService || null;
    this.ledgerRepository = options.ledgerRepository || null;
    // PM-25: with the fiscal lock on, a box leaves only with an authorized NF-e (COURIER_REQUIRE_AUTHORIZED_NFE).
    this.nfeRepository = options.nfeRepository || null;
    this.nfeRequired = options.requireAuthorizedNfe === true;
    this.profileRepository = options.profileRepository || null;
    this.auditService = options.auditService || null;
    this.transactionalMailer = options.transactionalMailer || null;
    this.logger = options.logger || { error() {}, warn() {}, info() {} };
    // The live shipping settings, for the boxes of each cycle (shipping-boxes).
    this.shippingSettings = options.shippingSettings || (() => null);
    this.now = options.now || (() => new Date());
  }

  ensureReady() {
    if (!this.repository) throw new HttpError(503, 'Courier delivery repository is not available.');
    if (!this.adminBillingService) throw new HttpError(503, 'Billing service is not available.');
  }

  present(row) {
    if (!row) return null;
    return {
      id: row.id,
      subscription_id: row.subscription_id,
      stripe_invoice_id: row.stripe_invoice_id,
      method: row.method,
      courier_name: row.courier_name,
      tracking_url: row.tracking_url,
      cost_minor: row.cost_minor,
      currency: row.currency,
      note: row.note,
      status: row.status,
      out_for_delivery_at: toIso(row.out_for_delivery_at),
      delivered_at: toIso(row.delivered_at),
      failed_at: toIso(row.failed_at),
      failure_reason: row.failure_reason,
      failure_kind: row.failure_kind || null,
      canceled_at: toIso(row.canceled_at),
      created_by: row.created_by,
      updated_by: row.updated_by,
      created_at: toIso(row.created_at),
      updated_at: toIso(row.updated_at)
    };
  }

  // The market of a delivery is the market of its subscription, so another market answers 404.
  async requireDeliveryInScope(id, actor) {
    this.ensureReady();
    const row = await this.repository.findById(id);
    if (!row) throw new HttpError(404, 'Courier delivery not found.');
    const subscription = await this.adminBillingService.getSubscription(row.subscription_id, actor);
    return { row, subscription };
  }

  async listForSubscription(subscriptionId, actor = {}) {
    this.ensureReady();
    const subscription = await this.adminBillingService.getSubscription(subscriptionId, actor);
    const rows = await this.repository.listBySubscriptionId(subscription.id || subscriptionId);
    return {
      success: true,
      data: {
        recipient_name: recipientDisplayName(subscription.address, subscription.user && subscription.user.email),
        items: rows.map((row) => this.present(row))
      }
    };
  }

  // Same checks as a UPS purchase, for the Brazil shipping market: account `br` and address in Brazil.
  async requireDeliverableInvoice(subscriptionId, subscription, invoiceId, actor) {
    const { market } = shipmentMarket({ stripeAccount: subscription.stripeAccount, address: subscription.address });
    if (market === 'US') {
      throw new HttpError(422, 'Courier deliveries are only for subscriptions delivered in Brazil.', { code: 'courier_country_not_supported' });
    }
    if (market !== 'BR') {
      throw marketExceptionError();
    }
    const invoice = await this.adminBillingService.getSubscriptionInvoice(subscriptionId, invoiceId, actor);
    if (extractSubscriptionIdFromInvoice(invoice) !== subscription.stripeSubscriptionId) {
      throw new HttpError(422, 'This invoice does not belong to the subscription.', { code: 'invoice_not_in_subscription' });
    }
    if (invoice.status !== 'paid') {
      throw new HttpError(422, 'Only a paid invoice can be dispatched.', { code: 'invoice_not_paid' });
    }
    if (!isChargedDeliveryInvoice(invoice)) {
      throw new HttpError(422, 'This invoice is not a charged delivery, so there is no box to dispatch.', { code: 'invoice_not_delivery' });
    }
    return invoice;
  }

  // A lock, not a warning: no field of the request releases it, `confirm_not_ready` included.
  async requireAuthorizedNfe(subscription, invoiceId) {
    if (!this.nfeRequired) return;
    if (!this.nfeRepository || typeof this.nfeRepository.findByStripeInvoice !== 'function') {
      throw new HttpError(503, 'NF-e repository is not available.');
    }
    const note = await this.nfeRepository.findByStripeInvoice(subscription.stripeAccount, invoiceId);
    if (note && note.status === NFE_AUTHORIZED) return;
    throw new HttpError(422, 'The box only leaves with an authorized NF-e.', {
      code: 'courier_nfe_not_authorized',
      nfe_status: note ? note.status : null,
      nfe_id: note ? note.id : null
    });
  }

  async readinessReasons(subscription, invoiceId) {
    return invoiceReadinessReasons(this.ledgerRepository, subscription, invoiceId);
  }

  async dispatch({ subscriptionId, body = {}, actor = {} }) {
    this.ensureReady();
    const invoiceId = String(body.invoice_id || '').trim();
    if (!invoiceId) {
      throw new HttpError(400, 'invoice_id is required.', { code: 'invoice_id_required' });
    }
    const details = parseCourierDetails(body, { required: true });
    const subscription = await this.adminBillingService.getSubscription(subscriptionId, actor);
    await this.requireDeliverableInvoice(subscriptionId, subscription, invoiceId, actor);

    // A lock, not a warning: no confirmation sends a box to an address the courier cannot use.
    const issues = brazilAddressIssues(subscription.address);
    if (issues.length) {
      await this.reportAddressIssue(subscription, 'courier_check');
      throw new HttpError(422, 'The delivery address is incomplete, so the box cannot leave.', { code: 'courier_address_incomplete', issues });
    }

    await this.requireAuthorizedNfe(subscription, invoiceId);

    const reasons = await this.readinessReasons(subscription, invoiceId);
    if (reasons.length && body.confirm_not_ready !== true) {
      throw new HttpError(409, 'This order is not ready to leave. Confirm to dispatch it anyway.', {
        code: 'courier_dispatch_needs_confirmation',
        reasons
      });
    }

    const { inserted, row } = await this.repository.insert({
      ...details,
      subscriptionId: String(subscription.id || subscriptionId),
      userId: subscription.user && subscription.user.id ? subscription.user.id : null,
      stripeAccount: subscription.stripeAccount || null,
      invoiceId,
      outForDeliveryAt: this.now(),
      actorId: actor.userId
    });
    if (!inserted) {
      throw new HttpError(409, 'This invoice already has a courier delivery on the road or delivered.', { code: 'courier_delivery_active' });
    }

    await this.audit(actor, 'courier_delivery.dispatch', subscription, row, { confirmedNotReady: reasons.length > 0 ? reasons.map((reason) => reason.code) : undefined });
    await this.notify('notifyCourierOutForDelivery', subscription, row);
    return { success: true, data: { delivery: this.present(row) } };
  }

  // delivery-address-issues: a side effect that only logs its own errors.
  async reportAddressIssue(subscription, source, extra = []) {
    if (!this.addressIssueService) return;
    await this.addressIssueService.report({ subscription, source, extra });
  }

  // Zero rows changed means another request closed it first, or it is gone.
  async afterTransition(id, affected) {
    if (affected > 0) return this.repository.findById(id);
    const current = await this.repository.findById(id);
    if (!current) throw new HttpError(404, 'Courier delivery not found.');
    throw finalError();
  }

  parseDeliveredAt(value, row) {
    const now = this.now();
    if (value === undefined || value === null || value === '') return now;
    const at = new Date(String(value));
    if (Number.isNaN(at.getTime())) throw invalidField('delivered_at', 'delivered_at must be a date and time.');
    if (at.getTime() > now.getTime()) throw invalidField('delivered_at', 'The delivery cannot be in the future.');
    // The panel sends whole minutes, so the minute the box left counts as after it left.
    const leftAt = toTime(row.out_for_delivery_at);
    if (at.getTime() < Math.floor(leftAt / 60000) * 60000) {
      throw invalidField('delivered_at', 'The delivery cannot be before the box left.');
    }
    return at.getTime() < leftAt ? new Date(leftAt) : at;
  }

  async markDelivered(id, body = {}, actor = {}) {
    const { row, subscription } = await this.requireDeliveryInScope(id, actor);
    if (row.status !== 'out_for_delivery') throw finalError();
    const at = this.parseDeliveredAt(body.delivered_at, row);
    const saved = await this.afterTransition(row.id, await this.repository.transition(row.id, 'delivered', { at, actorId: actor.userId }));
    await this.audit(actor, 'courier_delivery.delivered', subscription, saved, { deliveredAt: toIso(at) });
    await this.notify('notifyCourierDelivered', subscription, saved);
    return { success: true, data: { delivery: this.present(saved) } };
  }

  async markFailed(id, body = {}, actor = {}) {
    const { row, subscription } = await this.requireDeliveryInScope(id, actor);
    if (row.status !== 'out_for_delivery') throw finalError();
    const reason = parseFailureReason(body.reason);
    const kind = parseFailureKind(body.failure_kind);
    const saved = await this.afterTransition(row.id, await this.repository.transition(row.id, 'failed', { at: this.now(), reason, kind, actorId: actor.userId }));
    await this.audit(actor, 'courier_delivery.failed', subscription, saved, { reason, failureKind: kind || undefined });
    // The operator's text stays in the panel; the customer only learns the address could not be used.
    if (kind === 'address_unusable') {
      await this.reportAddressIssue(subscription, 'courier_failed', ['courier_address_unusable']);
    }
    return { success: true, data: { delivery: this.present(saved) } };
  }

  async cancel(id, actor = {}) {
    const { row, subscription } = await this.requireDeliveryInScope(id, actor);
    if (row.status !== 'out_for_delivery') throw finalError();
    const saved = await this.afterTransition(row.id, await this.repository.transition(row.id, 'canceled', { at: this.now(), actorId: actor.userId }));
    await this.audit(actor, 'courier_delivery.cancel', subscription, saved);
    return { success: true, data: { delivery: this.present(saved) } };
  }

  async updateDetails(id, body = {}, actor = {}) {
    const { row, subscription } = await this.requireDeliveryInScope(id, actor);
    if (row.status === 'canceled') throw finalError();
    const details = parseCourierDetails(body);
    if (!Object.keys(details).length) {
      throw new HttpError(422, 'Send at least one detail to change.', { code: 'courier_details_empty' });
    }
    const saved = await this.afterTransition(row.id, await this.repository.updateDetails(row.id, details, actor.userId));
    await this.audit(actor, 'courier_delivery.update', subscription, saved, { fields: Object.keys(details) });
    return { success: true, data: { delivery: this.present(saved) } };
  }

  // The four groups of Brazil delivery work. Only "to dispatch" is read by the delivery range (from the 30-day
  // floor to tomorrow by default); an invoice lands in one group only. Days are civil days in São Paulo, today
  // counted. The 200-row limit counts only cycles still to dispatch.
  async listQueue(actor = {}, query = {}) {
    this.ensureReady();
    const preparo = parsePreparo(query.preparo);
    const readyOnly = preparo === 'prontos';
    const range = resolveDeliveryRange(query, { now: this.now(), zone: TIMEZONE });
    const presentRange = { from: range.from, to: range.to, default: range.default };
    const empty = { to_dispatch: [], out_for_delivery: [], failed: [], delivered: [], truncated: false, range: presentRange, preparo, later: 0, next_from: null, nfe_required: this.nfeRequired };
    let accounts = null;
    if (shouldEnforceMarketScope(actor)) {
      const scope = constrainMarketQuery(actor, {});
      if (!scope.markets.includes('BR')) return { success: true, data: empty };
      accounts = new Set(scope.stripeAccounts);
    }
    if (!this.ledgerRepository || typeof this.ledgerRepository.listPaidCourierCycles !== 'function') {
      throw new HttpError(503, 'Subscription ledger is not available.');
    }

    const today = DateTime.fromJSDate(this.now(), { zone: TIMEZONE }).startOf('day');
    const courierTableName = this.repository.tableName || 'courier_deliveries';
    const cycles = await this.ledgerRepository.listPaidCourierCycles({
      deliveryFloor: range.from,
      deliveryCeiling: range.to,
      limit: QUEUE_LIMIT + 1,
      courierTableName,
      readyOnly
    });
    const later = typeof this.ledgerRepository.countPaidCourierCyclesToDispatch === 'function'
      ? this.ledgerRepository.countPaidCourierCyclesToDispatch({
        deliveryFloor: dayAfter(range.to, TIMEZONE),
        courierTableName,
        stripeAccounts: accounts ? [...accounts] : null,
        readyOnly
      })
      : Promise.resolve(0);
    const [onTheRoad, failedRows, deliveredRows] = await Promise.all([
      this.repository.listByStatus('out_for_delivery'),
      this.repository.listByStatus('failed'),
      this.repository.listDeliveredSince(today.minus({ days: DELIVERED_WINDOW_DAYS - 1 }).toUTC().toJSDate())
    ]);

    const cyclePage = cycles.slice(0, QUEUE_LIMIT);
    const failedInvoices = [...new Set(failedRows.map((row) => row.stripe_invoice_id))];
    const related = await this.repository.listByInvoiceIds([...cyclePage.map((cycle) => cycle.paidInvoiceId), ...failedInvoices]);
    const activeInvoices = new Set([...related, ...onTheRoad, ...deliveredRows].filter((row) => ACTIVE.has(row.status)).map((row) => row.stripe_invoice_id));
    const failedInvoiceSet = new Set([...related, ...failedRows].filter((row) => row.status === 'failed').map((row) => row.stripe_invoice_id));

    const latestFailed = new Map();
    for (const row of failedRows) {
      if (activeInvoices.has(row.stripe_invoice_id)) continue;
      const kept = latestFailed.get(row.stripe_invoice_id);
      if (!kept || row.id > kept.id) latestFailed.set(row.stripe_invoice_id, row);
    }

    const deliveries = [...onTheRoad, ...latestFailed.values(), ...deliveredRows];
    const known = new Map(cyclePage.map((cycle) => [cycle.paidInvoiceId, cycle]));
    const missing = deliveries.map((row) => row.stripe_invoice_id).filter((invoiceId) => !known.has(invoiceId));
    if (missing.length) {
      for (const cycle of await this.ledgerRepository.listPaidCyclesByInvoiceIds(missing)) known.set(cycle.paidInvoiceId, cycle);
    }

    const inScope = (cycle, row) => {
      if (!accounts) return true;
      const account = String((cycle && cycle.stripeAccount) || (row && row.stripe_account) || '').toLowerCase();
      return accounts.has(account);
    };
    const contacts = await this.deliveryContacts([...known.values()]);
    const item = (cycle, row) => this.presentQueueItem(cycle, row, contacts, actor);
    const truncated = cycles.length > QUEUE_LIMIT;
    const data = {
      ...empty,
      truncated,
      later: await later,
      next_from: truncated ? cycleDeliveryKey(cycles[QUEUE_LIMIT]) : null
    };
    const placed = new Set();
    const place = (group, cycle, row) => {
      const invoiceId = row ? row.stripe_invoice_id : cycle.paidInvoiceId;
      if (placed.has(invoiceId) || !inScope(cycle, row)) return;
      placed.add(invoiceId);
      data[group].push(item(cycle, row));
    };

    onTheRoad.forEach((row) => place('out_for_delivery', known.get(row.stripe_invoice_id), row));
    deliveredRows.forEach((row) => place('delivered', known.get(row.stripe_invoice_id), row));
    latestFailed.forEach((row) => place('failed', known.get(row.stripe_invoice_id), row));
    cyclePage
      .filter((cycle) => !activeInvoices.has(cycle.paidInvoiceId) && !failedInvoiceSet.has(cycle.paidInvoiceId))
      .forEach((cycle) => place('to_dispatch', cycle, null));
    await this.attachAddressIssues([...data.to_dispatch, ...data.failed]);
    await this.attachNfe([...data.to_dispatch, ...data.failed], known);
    return { success: true, data };
  }

  // delivery-address-issues: the rows a problem can still hold back carry it, read for the page at once.
  async attachAddressIssues(items) {
    if (!this.addressIssueService || items.length === 0) return;
    const latest = await this.addressIssueService.latestForSubscriptions(items.map((item) => Number(item.subscription_id)));
    for (const item of items) {
      item.address_issue = latest.get(Number(item.subscription_id)) || null;
    }
  }

  // PM-25: the rows whose box can still leave carry the NF-e of their invoice, in the cycle's Stripe account, read
  // for the page at once. Without the repository they carry nothing.
  async attachNfe(items, cycles) {
    if (!this.nfeRepository || typeof this.nfeRepository.listByStripeInvoices !== 'function' || items.length === 0) return;
    const accountOf = (item) => {
      const cycle = cycles.get(item.invoice_id);
      return String((cycle && cycle.stripeAccount) || item.stripe_account || '').toLowerCase();
    };
    const pairs = items.map((item) => ({ stripeAccount: accountOf(item), stripeInvoiceId: item.invoice_id }));
    const notes = new Map((await this.nfeRepository.listByStripeInvoices(pairs))
      .map((note) => [`${String(note.stripeAccount).toLowerCase()}|${note.stripeInvoiceId}`, note]));
    for (const item of items) {
      const note = notes.get(`${accountOf(item)}|${item.invoice_id}`);
      item.nfe = note ? { id: note.id, status: note.status, number: note.nfeNumber || null } : null;
    }
  }

  // Phone and instructions are read for every row at once; without the profile repository they stay empty.
  async deliveryContacts(cycles) {
    if (!this.profileRepository || typeof this.profileRepository.listDeliveryContacts !== 'function') return new Map();
    const userIds = cycles.map((cycle) => cycle && cycle.userId).filter(Boolean);
    return userIds.length ? this.profileRepository.listDeliveryContacts(userIds) : new Map();
  }

  // The queue's groups as counts for Today, by the same rules and without the 200-row cut.
  async countQueue(actor = {}) {
    const zero = { toDispatch: 0, addressLocked: 0, onTheRoadLong: 0, failed: 0, awaitingNfe: this.nfeRequired ? 0 : null };
    let accounts = null;
    if (shouldEnforceMarketScope(actor)) {
      const scope = constrainMarketQuery(actor, {});
      if (!scope.markets.includes('BR')) return zero;
      accounts = scope.stripeAccounts;
    }
    if (!this.repository || !this.ledgerRepository || typeof this.ledgerRepository.countPaidCourierCyclesToDispatch !== 'function') {
      return zero;
    }
    const now = this.now();
    const today = DateTime.fromJSDate(now, { zone: TIMEZONE }).startOf('day');
    // The queue's default range and default preparo (ready only), so the count matches the list Today opens.
    const toDispatchQuery = {
      deliveryFloor: today.minus({ days: DISPATCH_FLOOR_DAYS }).toISODate(),
      deliveryCeiling: today.plus({ days: 1 }).toISODate(),
      courierTableName: this.repository.tableName || 'courier_deliveries',
      stripeAccounts: accounts,
      readyOnly: true
    };
    const [toDispatch, addressLocked, onTheRoadLong, failed, awaitingNfe] = await Promise.all([
      this.ledgerRepository.countPaidCourierCyclesToDispatch(toDispatchQuery),
      // keep-ready-orders-dispatchable: the same cycles whose address the dispatch would refuse, by its own rule.
      this.countAddressLocked(toDispatchQuery),
      this.repository.countOnTheRoadSince(new Date(now.getTime() - LONG_ON_THE_ROAD_HOURS * 3600 * 1000), accounts),
      this.repository.countOpenFailures(accounts),
      // PM-25: the same cycles, without an authorized NF-e. Null while the lock is off.
      this.nfeRequired
        ? this.ledgerRepository.countPaidCourierCyclesToDispatch({ ...toDispatchQuery, nfeTableName: 'bling_nfe' })
        : Promise.resolve(null)
    ]);
    return { toDispatch, addressLocked, onTheRoadLong, failed, awaitingNfe };
  }

  // A read only: no address problem opens and no email goes out (delivery-address-issues).
  async countAddressLocked(query) {
    if (typeof this.ledgerRepository.listPaidCourierCycleAddresses !== 'function') return 0;
    const addresses = await this.ledgerRepository.listPaidCourierCycleAddresses(query);
    return addresses.filter((address) => brazilAddressIssues(address).length > 0).length;
  }

  presentQueueItem(cycle, row, contacts = new Map(), actor = {}) {
    const address = addressOf(cycle ? cycle.address : null);
    const contact = (cycle && contacts.get(String(cycle.userId))) || {};
    // The item is built here, so the presenter's boxes are copied next to its line items (shipping-boxes).
    const presented = cycle ? presentProductionQueueItem(cycle, { shippingSettings: this.shippingSettings() }) : null;
    const lineItems = presented ? presented.lineItems : [];
    const boxes = presented ? presented.boxes : [];
    // A live profile read: only when the profile is in the actor's markets (admin-market-scope).
    const accountName = cycle && canAccessMarket(actor, cycle.profileMarket) ? accountNameOf(cycle.accountDisplayName) : null;
    const shown = shownName(address, { accountName, email: cycle && cycle.customerEmail });
    const value = (...keys) => {
      for (const key of keys) {
        const text = String(address[key] == null ? '' : address[key]).trim();
        if (text) return text;
      }
      return null;
    };
    return {
      subscription_id: String((cycle && cycle.id) || (row && row.subscription_id) || ''),
      stripe_subscription_id: cycle ? cycle.stripeSubscriptionId : null,
      invoice_id: row ? row.stripe_invoice_id : cycle.paidInvoiceId,
      recipient_name: shown.name || null,
      name_source: shown.source,
      account_name: accountName,
      neighborhood: address.neighborhood || null,
      city: address.city || null,
      zipcode: address.postal_code || address.zipcode || address.zipCode || null,
      // The subscription address, the one the box goes to, laid out for the courier app.
      address: {
        street: value('street', 'address_line1', 'line1', 'address'),
        number: value('number'),
        complement: value('complement', 'address_line2', 'line2'),
        neighborhood: value('neighborhood'),
        city: value('city'),
        state: value('state'),
        zipcode: value('postal_code', 'zipcode', 'zipCode')
      },
      phone: contact.phone || null,
      // A copy kept in the customer's profile, not in the subscription address.
      delivery_instructions: contact.deliveryInstructions || null,
      delivery_instructions_source: 'profile',
      items: lineItems.map((line) => ({ flavor: line.flavor, quantity: line.quantity, pack_size: line.packSize || null })),
      boxes,
      delivery_date: cycle ? cycle.deliveryDate || null : null,
      production_status: cycle ? cycle.productionStatus : null,
      subscription_status: cycle ? cycle.status : null,
      customer_shipping: customerShippingOf(cycle ? cycle.shipping : null),
      delivery: row ? this.present(row) : null,
      // What the dispatch check would refuse, for the rows that can still be dispatched.
      ...(groupCanDispatch(row) ? { issues: cycle ? brazilAddressIssues(cycle.address) : [] } : {})
    };
  }

  async audit(actor, action, subscription, row, extra = {}) {
    if (!this.auditService || typeof this.auditService.record !== 'function') return;
    const metadata = {
      courierDeliveryId: row ? row.id : null,
      subscriptionId: subscription ? String(subscription.id || '') : null,
      invoiceId: row ? row.stripe_invoice_id : null,
      status: row ? row.status : null
    };
    for (const [key, value] of Object.entries(extra)) {
      if (value !== undefined) metadata[key] = value;
    }
    await this.auditService.record({
      actor,
      action,
      targetUserId: subscription && subscription.user && subscription.user.id ? subscription.user.id : null,
      targetEmail: subscription && subscription.user ? subscription.user.email || null : null,
      metadata
    });
  }

  // Sent only after the write won; a send failure is logged and never undoes the status or retries.
  async notify(method, subscription, row) {
    if (!this.transactionalMailer || typeof this.transactionalMailer[method] !== 'function') return;
    try {
      await this.transactionalMailer[method]({ subscription, delivery: row });
    } catch (error) {
      this.logger.error({ err: error && error.message, method, courierDeliveryId: row && row.id }, 'Courier delivery letter failed to send.');
    }
  }
}

module.exports = { CourierDeliveryService };
