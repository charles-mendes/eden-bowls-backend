const { HttpError } = require('./http-error');
const MAX_TRANSIT_DAYS_US = 1;
const MAX_DELIVERY_RADIUS_KM_BR = 40;
const TIMEZONE_BR = 'America/Sao_Paulo';
const TIMEZONE_US = 'America/New_York';

const BRAZIL_FIXED = [
  [1, 1, 'Confraternização Universal'],
  [4, 21, 'Tiradentes'],
  [5, 1, 'Dia do Trabalho'],
  [9, 7, 'Independência do Brasil'],
  [10, 12, 'Nossa Senhora Aparecida'],
  [11, 2, 'Finados'],
  [11, 15, 'Proclamação da República'],
  [11, 20, 'Dia da Consciência Negra'],
  [12, 25, 'Natal']
];

const US_2026_CLOSED = [
  ['2026-01-01', 'New Year\'s Day'],
  ['2026-01-19', 'Martin Luther King Jr. Day'],
  ['2026-04-05', 'Easter'],
  ['2026-05-10', 'Mother\'s Day'],
  ['2026-05-25', 'Memorial Day'],
  ['2026-07-04', 'Independence Day'],
  ['2026-09-07', 'Labor Day'],
  ['2026-11-26', 'Thanksgiving'],
  ['2026-12-25', 'Christmas Day'],
  ['2027-01-01', 'New Year\'s Day']
];

function dateKey(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseDateKey(value) {
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
  return { year, month, day };
}

function addCalendarDays(year, month, day, days) {
  const utc = new Date(Date.UTC(year, month - 1, day + days));
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate()
  };
}

function weekday(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + (2 * e) + (2 * i) - h - k) % 7;
  const m = Math.floor((a + (11 * h) + (22 * l)) / 451);
  const month = Math.floor((h + l - (7 * m) + 114) / 31);
  const day = ((h + l - (7 * m) + 114) % 31) + 1;
  return { year, month, day };
}

const TYPE_BY_ORIGIN = {
  fixed: 'national',
  movable: 'national',
  ups: 'carrier',
  regional: 'regional',
  one_off: 'adhoc'
};

// A date holds one row per type; rows read before the type column existed fall back to their origin.
function rowType(item) {
  return item.type || TYPE_BY_ORIGIN[item.origin] || null;
}

function row(market, closedOn, label, origin, flags) {
  return {
    market,
    closedOn,
    label,
    origin,
    type: TYPE_BY_ORIGIN[origin],
    active: true,
    closesPreparation: flags.prep,
    closesPickup: flags.pickup,
    closesDelivery: flags.delivery
  };
}

const ALL_CLOSED = { prep: true, pickup: true, delivery: true };

function buildBrazilHolidayRows(year) {
  const easter = easterSunday(year);
  const movable = [
    [addCalendarDays(easter.year, easter.month, easter.day, -48), 'Carnaval (segunda)'],
    [addCalendarDays(easter.year, easter.month, easter.day, -47), 'Carnaval (terça)'],
    [addCalendarDays(easter.year, easter.month, easter.day, -2), 'Paixão de Cristo'],
    [addCalendarDays(easter.year, easter.month, easter.day, 60), 'Corpus Christi']
  ];
  const fixed = BRAZIL_FIXED.map(([month, day, label]) => row(
    'BR',
    dateKey(year, month, day),
    label,
    'fixed',
    ALL_CLOSED
  ));
  const moving = movable.map(([parts, label]) => row(
    'BR',
    dateKey(parts.year, parts.month, parts.day),
    label,
    'movable',
    ALL_CLOSED
  ));
  return fixed.concat(moving);
}

function buildUs2026Rows() {
  const closed = US_2026_CLOSED.map(([closedOn, label]) => row('US', closedOn, label, 'ups', ALL_CLOSED));
  closed.push(row('US', '2026-12-24', 'Christmas Eve', 'ups', { prep: false, pickup: true, delivery: false }));
  closed.push(row('US', '2026-12-31', 'New Year\'s Eve', 'ups', { prep: false, pickup: true, delivery: true }));
  return closed;
}

function buildSeedRows() {
  return buildBrazilHolidayRows(2026)
    .concat(buildBrazilHolidayRows(2027))
    .concat(buildUs2026Rows());
}

function activeRows(rows, market, closedOn) {
  return (rows || []).filter((item) => item
    && item.active !== false
    && item.market === market
    && String(item.closedOn).slice(0, 10) === closedOn);
}

function flagOn(rows, market, closedOn, flag) {
  return activeRows(rows, market, closedOn).some((item) => item[flag]);
}

function yearHasBrazilNationalRows(rows, year) {
  return (rows || []).some((item) => item
    && item.market === 'BR'
    && rowType(item) === 'national'
    && String(item.closedOn).startsWith(`${year}-`));
}

function usYearHasCalendar(rows, year) {
  const ups = (rows || []).filter((item) => item
    && item.active !== false
    && item.market === 'US'
    && rowType(item) === 'carrier'
    && String(item.closedOn).startsWith(`${year}-`));
  if (ups.length === 0) {
    return false;
  }
  if (ups.length === 1 && String(ups[0].closedOn).slice(5) === '01-01') {
    return false;
  }
  return true;
}

function assessUsCalendar(rows, year, logger) {
  const covered = usYearHasCalendar(rows, year);
  if (!covered && logger && typeof logger.warn === 'function') {
    logger.warn(
      { market: 'US', year },
      'UPS calendar is not loaded for this year; only Saturday and Sunday are closed besides stored rows.'
    );
  }
  return { covered };
}

function rowKey(item) {
  return `${item.market}|${String(item.closedOn).slice(0, 10)}|${rowType(item)}`;
}

function insertIgnoringConflict(rows, incoming) {
  const next = rows.slice();
  const seen = new Set(next.map(rowKey));
  for (const item of incoming) {
    const key = rowKey(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    next.push(item);
  }
  return next;
}

function ensureBrazilYear(rows, year) {
  if (yearHasBrazilNationalRows(rows, year)) {
    return { rows, generated: false };
  }
  return {
    rows: insertIgnoringConflict(rows, buildBrazilHolidayRows(year)),
    generated: true
  };
}

function zonedParts(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(instant);
  const map = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      map[part.type] = Number(part.value);
    }
  }
  return map;
}

function wallTimeToUtc(year, month, day, hour, minute, second, timeZone) {
  let utc = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = zonedParts(new Date(utc), timeZone);
    const shown = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const desired = Date.UTC(year, month - 1, day, hour, minute, second);
    utc += desired - shown;
  }
  return new Date(utc);
}

function localDate(instant, timeZone) {
  const parts = zonedParts(instant, timeZone);
  return { year: parts.year, month: parts.month, day: parts.day };
}

function timeZoneFor(market) {
  if (market === 'BR') return TIMEZONE_BR;
  if (market === 'US') return TIMEZONE_US;
  return null;
}

function isSunday(parts) {
  return weekday(parts.year, parts.month, parts.day) === 0;
}

function isWeekend(parts) {
  const day = weekday(parts.year, parts.month, parts.day);
  return day === 0 || day === 6;
}

function brazilPrepValid(parts, rows) {
  const key = dateKey(parts.year, parts.month, parts.day);
  if (isSunday(parts)) return false;
  if (flagOn(rows, 'BR', key, 'closesPreparation')) return false;
  return true;
}

function usPrepValid(parts, rows, transitDays) {
  const day = weekday(parts.year, parts.month, parts.day);
  if (day < 1 || day > 5) return false;
  const key = dateKey(parts.year, parts.month, parts.day);
  if (flagOn(rows, 'US', key, 'closesPreparation')) return false;
  const pickup = addCalendarDays(parts.year, parts.month, parts.day, 1);
  if (isWeekend(pickup) || flagOn(rows, 'US', dateKey(pickup.year, pickup.month, pickup.day), 'closesPickup')) {
    return false;
  }
  const delivery = addCalendarDays(pickup.year, pickup.month, pickup.day, transitDays);
  if (isWeekend(delivery) || flagOn(rows, 'US', dateKey(delivery.year, delivery.month, delivery.day), 'closesDelivery')) {
    return false;
  }
  return true;
}

function deliveryForPrep(market, parts, transitDays) {
  if (market === 'BR') {
    return parts;
  }
  const pickup = addCalendarDays(parts.year, parts.month, parts.day, 1);
  return addCalendarDays(pickup.year, pickup.month, pickup.day, transitDays);
}

function firstPrepDay(market, chargeAt, rows, transitDays) {
  const timeZone = timeZoneFor(market);
  const start = localDate(chargeAt, timeZone);
  for (let offset = 0; offset < 21; offset += 1) {
    const parts = addCalendarDays(start.year, start.month, start.day, offset);
    const midnight = wallTimeToUtc(parts.year, parts.month, parts.day, 0, 0, 0, timeZone);
    if (midnight.getTime() < chargeAt.getTime()) {
      continue;
    }
    const valid = market === 'BR'
      ? brazilPrepValid(parts, rows)
      : usPrepValid(parts, rows, transitDays);
    if (valid) {
      return parts;
    }
  }
  return null;
}

function editableUntil(chargeAt, timeZone) {
  const chargeDay = localDate(chargeAt, timeZone);
  const previous = addCalendarDays(chargeDay.year, chargeDay.month, chargeDay.day, -1);
  return wallTimeToUtc(previous.year, previous.month, previous.day, 23, 59, 59, timeZone);
}

function addressUnavailable(market, { distanceKm, transitDays } = {}) {
  if (market === 'BR' && Number(distanceKm) > MAX_DELIVERY_RADIUS_KM_BR) {
    return true;
  }
  if (market === 'US' && Number(transitDays) > MAX_TRANSIT_DAYS_US) {
    return true;
  }
  return false;
}

function deliveryAreaQuote(quote = {}) {
  const distanceKm = quote.distanceKm != null ? quote.distanceKm : quote.distance;
  const transitRaw = quote.transitDays != null
    ? quote.transitDays
    : (quote.delivery_days != null ? quote.delivery_days : quote.deliveryDays);
  return {
    distanceKm: distanceKm == null || distanceKm === '' ? undefined : Number(distanceKm),
    transitDays: transitRaw == null || transitRaw === '' ? undefined : Number(transitRaw)
  };
}

function assertInsideDeliveryArea(market, quote = {}) {
  const normalized = String(market || '').toUpperCase();
  const { distanceKm, transitDays } = deliveryAreaQuote(quote);
  // The saved shipping snapshot stores a missing distance or transit as 0.
  if (normalized === 'BR' && !(distanceKm > 0)) {
    throw new HttpError(422, 'delivery_area_unverified', { code: 'delivery_area_unverified' });
  }
  if (normalized === 'US' && !(transitDays > 0)) {
    throw new HttpError(422, 'delivery_area_unverified', { code: 'delivery_area_unverified' });
  }
  if (addressUnavailable(normalized, { distanceKm, transitDays })) {
    throw new HttpError(422, 'outside_delivery_area', { code: 'outside_delivery_area' });
  }
}

module.exports = {
  MAX_TRANSIT_DAYS_US,
  MAX_DELIVERY_RADIUS_KM_BR,
  TIMEZONE_BR,
  TIMEZONE_US,
  dateKey,
  parseDateKey,
  addCalendarDays,
  weekday,
  easterSunday,
  TYPE_BY_ORIGIN,
  rowType,
  buildBrazilHolidayRows,
  buildUs2026Rows,
  buildSeedRows,
  yearHasBrazilNationalRows,
  usYearHasCalendar,
  assessUsCalendar,
  insertIgnoringConflict,
  ensureBrazilYear,
  flagOn,
  zonedParts,
  wallTimeToUtc,
  localDate,
  timeZoneFor,
  brazilPrepValid,
  usPrepValid,
  deliveryForPrep,
  firstPrepDay,
  editableUntil,
  addressUnavailable,
  assertInsideDeliveryArea
};
