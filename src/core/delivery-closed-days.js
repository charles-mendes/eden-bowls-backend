const { HttpError } = require('./http-error');
const MAX_TRANSIT_DAYS_US = 1;
const MAX_DELIVERY_RADIUS_KM_BR = 50;
// Brazil delivery time the operator picks: 0 (the same day as preparation) to 3 business days after it.
const BR_DELIVERY_DAYS_MAX = 3;
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

// The standard week of a market (delivery-calendar): seven days, Monday first (weekday 1) to Sunday (7), each open
// or not, with its hours in the market's time zone. "Open" is about preparation only.
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

function weekOf(openDays, opensAt = '09:00', closesAt = '20:00') {
  return WEEKDAYS.map((weekday) => ({ weekday, open: openDays.includes(weekday), opensAt, closesAt }));
}

// The week the code applied before the table: what the migration seeds and what a bare list of closed days reads.
const DEFAULT_OPERATING_WEEK = Object.freeze({
  BR: weekOf([1, 2, 3, 4, 5, 6]),
  US: weekOf([1, 2, 3, 4, 5])
});

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

// The calendar a rule reads: `{ rows, week }` (a snapshot), or a bare list of closed days, which reads with the
// default week. A snapshot missing one market's week reads that market with the default too.
function calendarOf(input) {
  if (Array.isArray(input) || input == null) {
    return { rows: input || [], week: DEFAULT_OPERATING_WEEK };
  }
  return {
    rows: input.rows || [],
    week: { ...DEFAULT_OPERATING_WEEK, ...(input.week || {}) }
  };
}

// Monday = 1 … Sunday = 7, the weekday numbering of the operating week.
function isoWeekday(parts) {
  return weekday(parts.year, parts.month, parts.day) || 7;
}

function weekDay(calendar, market, parts) {
  const days = calendarOf(calendar).week[market] || [];
  return days.find((day) => day.weekday === isoWeekday(parts)) || null;
}

function openWeekday(calendar, market, parts) {
  const day = weekDay(calendar, market, parts);
  return Boolean(day && day.open);
}

function activeRows(input, market, closedOn) {
  return calendarOf(input).rows.filter((item) => item
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

// 31 December of the last United States year with a loaded UPS calendar, or null when no year is loaded.
function usCalendarCoveredThrough(rows) {
  const years = new Set((rows || [])
    .filter((item) => item && item.market === 'US' && rowType(item) === 'carrier')
    .map((item) => Number(String(item.closedOn).slice(0, 4))));
  const covered = [...years].filter((year) => usYearHasCalendar(rows, year)).sort((left, right) => right - left);
  return covered.length > 0 ? `${covered[0]}-12-31` : null;
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

function isWeekend(parts) {
  const day = weekday(parts.year, parts.month, parts.day);
  return day === 0 || day === 6;
}

// A preparation day: the weekday is open in the market's week and no closed day closes preparation on the date.
// `calendar` is a snapshot `{ rows, week }` or a bare list of closed days (see calendarOf).
function brazilPrepValid(parts, calendar) {
  const key = dateKey(parts.year, parts.month, parts.day);
  if (!openWeekday(calendar, 'BR', parts)) return false;
  if (flagOn(calendar, 'BR', key, 'closesPreparation')) return false;
  return true;
}

// The United States ships through a weekday UPS pickup after the preparation day. The package waits in the
// kitchen until the first pickup day (not Saturday, Sunday or a day that closes pickup) whose delivery, the
// transit days later, is a weekday that does not close delivery. So a Thursday or Friday preparation is held
// and picked up on Monday. The hold is at most US_PICKUP_HOLD_MAX_DAYS.
const US_PICKUP_HOLD_MAX_DAYS = 7;

function usPickupFor(parts, calendar, transitDays) {
  for (let offset = 1; offset <= US_PICKUP_HOLD_MAX_DAYS; offset += 1) {
    const pickup = addCalendarDays(parts.year, parts.month, parts.day, offset);
    if (isWeekend(pickup) || flagOn(calendar, 'US', dateKey(pickup.year, pickup.month, pickup.day), 'closesPickup')) {
      continue;
    }
    const delivery = addCalendarDays(pickup.year, pickup.month, pickup.day, transitDays);
    if (isWeekend(delivery) || flagOn(calendar, 'US', dateKey(delivery.year, delivery.month, delivery.day), 'closesDelivery')) {
      continue;
    }
    return { pickup, delivery };
  }
  return null;
}

function usPrepValid(parts, calendar, transitDays) {
  if (!openWeekday(calendar, 'US', parts)) return false;
  if (flagOn(calendar, 'US', dateKey(parts.year, parts.month, parts.day), 'closesPreparation')) return false;
  return usPickupFor(parts, calendar, transitDays) !== null;
}

// Brazil: the business days after preparation, skipping Saturday, Sunday and the days that close delivery.
function brazilDeliveryForPrep(parts, calendar) {
  let delivery = parts;
  for (let left = brDeliveryDays; left > 0;) {
    delivery = addCalendarDays(delivery.year, delivery.month, delivery.day, 1);
    if (!isWeekend(delivery) && !flagOn(calendar, 'BR', dateKey(delivery.year, delivery.month, delivery.day), 'closesDelivery')) {
      left -= 1;
    }
  }
  return delivery;
}

// `rows` (the calendar) only matters for Brazil, whose delivery time skips the days that close delivery.
function deliveryForPrep(market, parts, transitDays, rows = []) {
  if (market === 'BR') {
    return brazilDeliveryForPrep(parts, rows);
  }
  const planned = usPickupFor(parts, rows, transitDays);
  if (planned) return planned.delivery;
  const pickup = addCalendarDays(parts.year, parts.month, parts.day, 1);
  return addCalendarDays(pickup.year, pickup.month, pickup.day, transitDays);
}

// Minutes after local midnight of an `HH:MM` closing time.
function minutesOf(hhmm) {
  const [hour, minute] = String(hhmm || '').split(':').map(Number);
  return (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0);
}

// The preparation day of a payment (delivery-calendar): the payment's local date when it is a preparation day and
// the payment comes before that day's closing time (before opening counts, as a renewal charged at 00:00);
// otherwise the next preparation day.
function firstPrepDay(market, chargeAt, calendar, transitDays) {
  const timeZone = timeZoneFor(market);
  const local = zonedParts(chargeAt, timeZone);
  const start = { year: local.year, month: local.month, day: local.day };
  for (let offset = 0; offset < 21; offset += 1) {
    const parts = addCalendarDays(start.year, start.month, start.day, offset);
    if (offset === 0) {
      const today = weekDay(calendar, market, parts);
      if (!today || local.hour * 60 + local.minute >= minutesOf(today.closesAt)) {
        continue;
      }
    }
    const valid = market === 'BR'
      ? brazilPrepValid(parts, calendar)
      : usPrepValid(parts, calendar, transitDays);
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

// The admin edits the Brazil radius in the shipping settings; the default holds until settings load.
let brDeliveryRadiusKm = MAX_DELIVERY_RADIUS_KM_BR;

function setBrDeliveryRadiusKm(value) {
  const km = Number(value);
  brDeliveryRadiusKm = Number.isFinite(km) && km > 0 ? km : MAX_DELIVERY_RADIUS_KM_BR;
}

function currentBrDeliveryRadiusKm() {
  return brDeliveryRadiusKm;
}

let brDeliveryDays = 0;

function setBrDeliveryDays(value) {
  const days = Number(value);
  brDeliveryDays = Number.isInteger(days) && days >= 0 && days <= BR_DELIVERY_DAYS_MAX ? days : 0;
}

function currentBrDeliveryDays() {
  return brDeliveryDays;
}

// The admin edits the US transit limit in the shipping settings; the default holds until settings load.
let usMaxTransitDays = MAX_TRANSIT_DAYS_US;

function setUsMaxTransitDays(value) {
  const days = Number(value);
  usMaxTransitDays = Number.isInteger(days) && days > 0 ? days : MAX_TRANSIT_DAYS_US;
}

function currentUsMaxTransitDays() {
  return usMaxTransitDays;
}

function addressUnavailable(market, { distanceKm, transitDays } = {}) {
  if (market === 'BR' && Number(distanceKm) > brDeliveryRadiusKm) {
    return true;
  }
  if (market === 'US' && Number(transitDays) > usMaxTransitDays) {
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
  WEEKDAYS,
  calendarOf,
  isoWeekday,
  openWeekday,
  DEFAULT_OPERATING_WEEK,
  weekOf,
  MAX_TRANSIT_DAYS_US,
  MAX_DELIVERY_RADIUS_KM_BR,
  currentBrDeliveryRadiusKm,
  setBrDeliveryRadiusKm,
  BR_DELIVERY_DAYS_MAX,
  currentBrDeliveryDays,
  setBrDeliveryDays,
  currentUsMaxTransitDays,
  setUsMaxTransitDays,
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
  usCalendarCoveredThrough,
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
  usPickupFor,
  US_PICKUP_HOLD_MAX_DAYS,
  deliveryForPrep,
  firstPrepDay,
  editableUntil,
  addressUnavailable,
  assertInsideDeliveryArea
};
