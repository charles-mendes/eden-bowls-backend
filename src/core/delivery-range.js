const { DateTime } = require('luxon');
const { HttpError } = require('./http-error');

// The delivery range of a shipping queue (courier-delivery, ups-label-queue): civil dates in the market's timezone,
// both ends included. The default runs from the 30-day floor to tomorrow; `to` may be at most 31 days after `from`,
// which the default is exactly.
const FLOOR_DAYS = 30;
const MAX_SPAN_DAYS = 31;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function invalid(message) {
  return new HttpError(400, message, { code: 'invalid_delivery_range' });
}

function parseDate(value, zone, name) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value);
  const date = DATE_PATTERN.test(text) ? DateTime.fromISO(text, { zone }) : null;
  if (!date || !date.isValid) throw invalid(`${name} must be a date (YYYY-MM-DD).`);
  return date.startOf('day');
}

// `query` is `{ from, to }` as received; `now` a Date. Returns `{ from, to, default, floor }` (ISO dates) or throws
// `400 invalid_delivery_range`.
function resolveDeliveryRange(query = {}, { now = new Date(), zone }) {
  const today = DateTime.fromJSDate(now, { zone }).startOf('day');
  const floor = today.minus({ days: FLOOR_DAYS });
  const from = parseDate(query.from, zone, 'from');
  const to = parseDate(query.to, zone, 'to');
  const start = from || floor;
  const end = to || today.plus({ days: 1 });
  if (start < floor) throw invalid(`The range cannot start more than ${FLOOR_DAYS} days ago.`);
  if (end < start) throw invalid('The range cannot end before it starts.');
  if (end.diff(start, 'days').days > MAX_SPAN_DAYS) throw invalid(`The range cannot be longer than ${MAX_SPAN_DAYS} days.`);
  return {
    from: start.toISODate(),
    to: end.toISODate(),
    default: !from && !to,
    floor: floor.toISODate()
  };
}

function dayAfter(isoDate, zone) {
  return DateTime.fromISO(isoDate, { zone }).plus({ days: 1 }).toISODate();
}

module.exports = { resolveDeliveryRange, dayAfter, FLOOR_DAYS, MAX_SPAN_DAYS };
