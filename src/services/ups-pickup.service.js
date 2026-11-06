const { HttpError } = require('../core/http-error');
const { constrainMarketQuery, shouldEnforceMarketScope } = require('../core/admin-market-scope');
const { TIMEZONE_US, addCalendarDays, dateKey, flagOn, localDate, parseDateKey, weekday } = require('../core/delivery-closed-days');
const { upsRejectedShipment } = require('./ups-shipment.service');
const { STALE_PENDING_MS, effectivePickupStatus } = require('../core/ups-pickup-status');

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LIST_DAYS_BACK = 7;
// A pickup day is a US weekday the calendar does not close for pickup; the next one is at most this far.
const PICKUP_DAY_SEARCH = 14;

function refuse(status, message, code, extra = {}) {
  return new HttpError(status, message, { code, ...extra });
}

function canSeeUs(actor) {
  if (!shouldEnforceMarketScope(actor)) return true;
  try {
    return constrainMarketQuery(actor, {}).stripeAccounts.includes('us');
  } catch (_error) {
    return false;
  }
}

function actorName(actor = {}) {
  return String(actor.email || actor.userId || '').slice(0, 191) || null;
}

function isPickupDay(parts, rows) {
  const day = weekday(parts.year, parts.month, parts.day);
  return day >= 1 && day <= 5 && !flagOn(rows, 'US', dateKey(parts.year, parts.month, parts.day), 'closesPickup');
}

// Today (when it is a pickup day) and the next pickup day after today, as New York date keys.
function allowedPickupDates(now, rows) {
  const today = localDate(now, TIMEZONE_US);
  const allowed = [];
  if (isPickupDay(today, rows)) allowed.push(dateKey(today.year, today.month, today.day));
  for (let offset = 1; offset <= PICKUP_DAY_SEARCH; offset += 1) {
    const next = addCalendarDays(today.year, today.month, today.day, offset);
    if (isPickupDay(next, rows)) {
      allowed.push(dateKey(next.year, next.month, next.day));
      break;
    }
  }
  return allowed;
}

// The ship-from fields UPS needs for the pickup that are missing or too short.
function shipFromMissing(shipFrom = {}) {
  const missing = ['street', 'city', 'state'].filter((key) => !String(shipFrom[key] || '').trim());
  if (String(shipFrom.zipcode || '').replace(/\D/g, '').length < 5) missing.push('zipcode');
  if (String(shipFrom.phone || '').replace(/\D/g, '').length < 10) missing.push('phone');
  return missing;
}

// UPS on-demand pickups (ups-pickup): requested from the panel only on days with boxes, for that day's count.
class UpsPickupService {
  constructor(options = {}) {
    this.repository = options.repository || null;
    this.upsClient = options.upsClient || null;
    this.shippingService = options.shippingService || null;
    this.calendar = options.calendar || null;
    this.auditService = options.auditService || null;
    this.logger = options.logger || { error() {}, warn() {}, info() {} };
    this.now = options.now || (() => new Date());
  }

  ensureRepository() {
    if (!this.repository) throw new HttpError(503, 'UPS pickup repository is not available.');
  }

  ensureUps() {
    if (!this.upsClient || !this.upsClient.isConfigured()) {
      throw refuse(503, 'UPS is not configured.', 'ups_not_configured');
    }
    this.upsClient.ensureCanShip();
  }

  present(pickup) {
    if (!pickup) return null;
    return {
      id: pickup.id,
      pickup_date: pickup.pickup_date,
      ready_time: pickup.ready_time,
      close_time: pickup.close_time,
      package_count: pickup.package_count,
      status: effectivePickupStatus(pickup, this.now()),
      prn: pickup.prn,
      shipment_ids: pickup.shipment_ids,
      requested_by: pickup.requested_by,
      closed_by: pickup.closed_by,
      closed_at: pickup.closed_at,
      created_at: pickup.created_at
    };
  }

  async calendarRows() {
    if (!this.calendar || typeof this.calendar.listActive !== 'function') return [];
    return this.calendar.listActive();
  }

  async validate(body = {}) {
    const ids = Array.isArray(body.shipment_ids) ? body.shipment_ids.map(Number) : [];
    if (!ids.length || ids.some((id) => !Number.isInteger(id) || id <= 0)) {
      throw refuse(422, 'Choose the labels this pickup collects.', 'pickup_shipments_required');
    }
    const count = Number(body.package_count);
    if (!Number.isInteger(count) || count < 1) {
      throw refuse(422, 'The box count must be a whole number from 1.', 'pickup_count_invalid');
    }
    const readyTime = String(body.ready_time || '');
    const closeTime = String(body.close_time || '');
    if (!TIME_PATTERN.test(readyTime) || !TIME_PATTERN.test(closeTime) || closeTime <= readyTime) {
      throw refuse(422, 'The pickup window must be HH:MM, closing after it opens.', 'pickup_window_invalid');
    }
    const pickupDate = String(body.pickup_date || '');
    const allowed = DATE_PATTERN.test(pickupDate) ? allowedPickupDates(this.now(), await this.calendarRows()) : [];
    if (!allowed.includes(pickupDate)) {
      throw refuse(422, 'UPS has no pickup on this day. Choose today or the next pickup day.', 'pickup_date_not_allowed', { allowed_dates: allowed });
    }
    const settings = (this.shippingService && this.shippingService.settings && this.shippingService.settings.us) || {};
    const shipFrom = settings.ship_from || {};
    const missing = shipFromMissing(shipFrom);
    if (missing.length) {
      throw refuse(422, 'UPS needs the US ship-from address and a phone of 10 digits for the pickup.', 'pickup_ship_from_incomplete', { missing });
    }
    return { ids: [...new Set(ids)], count, readyTime, closeTime, pickupDate, settings, shipFrom };
  }

  async request({ actor = {}, body = {} } = {}) {
    this.ensureRepository();
    this.ensureUps();
    const input = await this.validate(body);
    if (!canSeeUs(actor)) {
      throw refuse(422, 'These labels cannot join a pickup.', 'pickup_shipment_not_eligible', { shipment_ids: input.ids });
    }

    const reserved = await this.repository.reserve({
      pickupDate: input.pickupDate,
      readyTime: input.readyTime,
      closeTime: input.closeTime,
      packageCount: input.count,
      shipmentIds: input.ids,
      requestedBy: actorName(actor)
    });
    if (!reserved.pickup) {
      throw refuse(422, 'Some labels cannot join a pickup: they are not created or already belong to one.', 'pickup_shipment_not_eligible', {
        shipment_ids: reserved.ineligibleIds
      });
    }
    const { pickup } = reserved;
    const codes = Array.isArray(input.settings.allowed_service_codes) ? input.settings.allowed_service_codes : [];

    let created;
    try {
      created = await this.upsClient.createPickup({
        pickupDate: input.pickupDate,
        readyTime: input.readyTime,
        closeTime: input.closeTime,
        packageCount: input.count,
        shipFrom: input.shipFrom,
        serviceCode: codes[0] || '03',
        weightLb: input.settings.package && input.settings.package.weight_lb
      });
    } catch (error) {
      if (upsRejectedShipment(error)) {
        await this.repository.deleteReservation(pickup.id).catch((deleteError) => {
          this.logger.error({ pickupId: pickup.id, code: deleteError && deleteError.code }, 'Refused UPS pickup could not be released.');
        });
        throw error;
      }
      const code = (error && error.details && error.details.code) || 'ups_error';
      await this.repository.markUnknown(pickup.id, code).catch((markError) => {
        this.logger.error({ pickupId: pickup.id, code: markError && markError.code }, 'UPS pickup could not be marked unknown.');
      });
      this.logger.error({ pickupId: pickup.id, code }, 'UPS pickup outcome is unknown.');
      await this.audit(actor, 'ups_pickup.unconfirmed', pickup.id, { code });
      throw refuse(502, 'UPS did not confirm the pickup. Check the UPS portal before requesting again.', 'pickup_unconfirmed', { pickup_id: pickup.id });
    }

    const saved = await this.repository.markRequested(pickup.id, { prn: created.prn, rawResponse: created.raw });
    await this.audit(actor, 'ups_pickup.request', pickup.id, {
      prn: created.prn,
      pickupDate: input.pickupDate,
      packageCount: input.count,
      shipmentIds: input.ids
    });
    return { success: true, data: { pickup: this.present(saved) } };
  }

  async requirePickup(id, actor) {
    this.ensureRepository();
    const pickup = canSeeUs(actor) ? await this.repository.findById(id) : null;
    if (!pickup) throw refuse(404, 'Pickup not found.', 'pickup_not_found');
    return pickup;
  }

  async cancel(id, actor = {}) {
    const pickup = await this.requirePickup(id, actor);
    if (pickup.status !== 'requested') {
      throw refuse(409, 'Only a requested pickup can be canceled.', 'pickup_not_cancelable', { status: pickup.status });
    }
    this.ensureUps();
    // A UPS refusal propagates and the pickup stays requested.
    await this.upsClient.cancelPickup(pickup.prn);
    await this.repository.close(pickup.id, { fromStatus: 'requested', toStatus: 'canceled', closedBy: actorName(actor) });
    await this.audit(actor, 'ups_pickup.cancel', pickup.id, { prn: pickup.prn });
    return { success: true, data: { pickup: this.present(await this.repository.findById(pickup.id)) } };
  }

  // Closes a pickup UPS never confirmed, after the operator checked the UPS portal. UPS is not called.
  async markNotCreated(id, actor = {}) {
    const pickup = await this.requirePickup(id, actor);
    const status = effectivePickupStatus(pickup, this.now());
    if (status !== 'unknown') {
      throw refuse(409, 'Only a pickup UPS did not confirm can be closed as not created.', 'pickup_not_unknown', { status });
    }
    const closed = await this.repository.close(pickup.id, {
      fromStatus: 'unknown',
      toStatus: 'not_created',
      closedBy: actorName(actor),
      pendingBefore: new Date(this.now().getTime() - STALE_PENDING_MS)
    });
    if (!closed) {
      throw refuse(409, 'Only a pickup UPS did not confirm can be closed as not created.', 'pickup_not_unknown');
    }
    await this.audit(actor, 'ups_pickup.not_created', pickup.id, {});
    return { success: true, data: { pickup: this.present(await this.repository.findById(pickup.id)) } };
  }

  async list(actor = {}, query = {}) {
    this.ensureRepository();
    let from = query.from == null || query.from === '' ? null : String(query.from);
    if (from !== null && !DATE_PATTERN.test(from)) {
      throw refuse(400, 'from must be YYYY-MM-DD.', 'invalid_from');
    }
    if (!from) {
      const today = localDate(this.now(), TIMEZONE_US);
      const start = addCalendarDays(today.year, today.month, today.day, -LIST_DAYS_BACK);
      from = dateKey(start.year, start.month, start.day);
    } else {
      const parts = parseDateKey(from);
      from = dateKey(parts.year, parts.month, parts.day);
    }
    if (!canSeeUs(actor)) return { success: true, data: { items: [], from } };
    const items = await this.repository.list({ from });
    return { success: true, data: { items: items.map((item) => this.present(item)), from } };
  }

  // A failed audit write is logged: the UPS call already happened.
  async audit(actor, action, pickupId, metadata) {
    if (!this.auditService || typeof this.auditService.record !== 'function') return;
    try {
      await this.auditService.record({ actor: actor || {}, action, targetUserId: null, targetEmail: null, metadata: { pickupId, ...metadata } });
    } catch (error) {
      this.logger.error({ pickupId, action, code: error && error.code }, 'UPS pickup action could not be audited.');
    }
  }
}

module.exports = { UpsPickupService, allowedPickupDates };
