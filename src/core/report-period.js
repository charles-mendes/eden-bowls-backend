const { HttpError } = require('./http-error');

const REPORT_TIMEZONES = {
  BR: 'America/Sao_Paulo',
  US: 'America/New_York'
};
const DEFAULT_DAYS = 30;
const MAX_DAYS = 366;
const GRANULARITIES = ['day', 'week', 'month'];
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function invalidPeriod(message) {
  return new HttpError(400, message, { code: 'report_period_invalid' });
}

function timezoneForMarket(market) {
  return REPORT_TIMEZONES[market] || REPORT_TIMEZONES.BR;
}

// Calendar dates are kept as YYYY-MM-DD strings; arithmetic runs on UTC midnight so no zone leaks in.
function parseDate(value) {
  if (!DATE_PATTERN.test(String(value || ''))) {
    return null;
  }
  const time = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) {
    return null;
  }
  return time;
}

function formatDate(time) {
  return new Date(time).toISOString().slice(0, 10);
}

function addDays(date, days) {
  return formatDate(parseDate(date) + days * DAY_MS);
}

function daysBetween(from, to) {
  return Math.round((parseDate(to) - parseDate(from)) / DAY_MS);
}

function wallClock(instant, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
}

function localDate(instant, timeZone) {
  return formatDate(wallClock(instant, timeZone));
}

// The UTC instant of local midnight on a calendar date. The offset is read twice so a DST switch on that
// day resolves to the offset in force at midnight.
function localMidnightUtc(date, timeZone) {
  const guess = parseDate(date);
  const first = guess - (wallClock(guess, timeZone) - guess);
  const offset = wallClock(first, timeZone) - first;
  return guess - offset;
}

function toMysql(instant) {
  return new Date(instant).toISOString().slice(0, 19).replace('T', ' ');
}

function defaultGranularity(days) {
  if (days <= 31) return 'day';
  if (days <= 120) return 'week';
  return 'month';
}

// Resolves the report window in the market's zone. The default is the 30 complete days ending yesterday;
// a window that ends today is cut at the current time and the previous window at the same local time.
function resolveReportPeriod(query = {}, { market, now = new Date() } = {}) {
  const timezone = timezoneForMarket(market);
  const nowMs = new Date(now).getTime();
  const today = localDate(nowMs, timezone);
  const hasFrom = query.from != null && query.from !== '';
  const hasTo = query.to != null && query.to !== '';

  let to = hasTo ? String(query.to) : addDays(today, -1);
  if (parseDate(to) === null) {
    throw invalidPeriod('Invalid end date.');
  }
  if (parseDate(to) > parseDate(today)) {
    to = today;
  }

  const from = hasFrom ? String(query.from) : addDays(to, -(DEFAULT_DAYS - 1));
  if (parseDate(from) === null) {
    throw invalidPeriod('Invalid start date.');
  }
  if (parseDate(from) > parseDate(to)) {
    throw invalidPeriod('The start date is after the end date.');
  }

  const days = daysBetween(from, to) + 1;
  if (days > MAX_DAYS) {
    throw invalidPeriod(`A report covers at most ${MAX_DAYS} days.`);
  }

  const requested = query.granularity == null || query.granularity === '' ? '' : String(query.granularity);
  if (requested && !GRANULARITIES.includes(requested)) {
    throw invalidPeriod('Granularity must be day, week or month.');
  }
  const granularity = requested || defaultGranularity(days);

  const previousTo = addDays(from, -1);
  const previousFrom = addDays(previousTo, -(days - 1));
  const partialToday = to === today;
  const startUtc = localMidnightUtc(from, timezone);
  const previousStartUtc = localMidnightUtc(previousFrom, timezone);
  const elapsedToday = nowMs - localMidnightUtc(today, timezone);
  const endUtc = partialToday ? nowMs : localMidnightUtc(addDays(to, 1), timezone);
  const previousEndUtc = partialToday
    ? localMidnightUtc(previousTo, timezone) + elapsedToday
    : localMidnightUtc(addDays(previousTo, 1), timezone);

  return {
    from,
    to,
    days,
    timezone,
    granularity,
    partialToday,
    today,
    previous: { from: previousFrom, to: previousTo },
    range: { start: toMysql(startUtc), end: toMysql(endUtc) },
    previousRange: { start: toMysql(previousStartUtc), end: toMysql(previousEndUtc) }
  };
}

function publicPeriod(period) {
  return {
    from: period.from,
    to: period.to,
    timezone: period.timezone,
    granularity: period.granularity,
    partialToday: period.partialToday,
    previous: { ...period.previous }
  };
}

function bucketStart(date, granularity) {
  if (granularity === 'week') {
    const weekday = new Date(parseDate(date)).getUTCDay();
    return addDays(date, -((weekday + 6) % 7));
  }
  if (granularity === 'month') {
    return `${date.slice(0, 7)}-01`;
  }
  return date;
}

function bucketEnd(start, granularity) {
  if (granularity === 'week') {
    return addDays(start, 6);
  }
  if (granularity === 'month') {
    const next = new Date(parseDate(start));
    next.setUTCMonth(next.getUTCMonth() + 1);
    return addDays(formatDate(next.getTime()), -1);
  }
  return start;
}

// Every bucket of the window, clipped to it. A bucket is partial when the window cuts its calendar span
// or when it holds today and today is still running.
function buildBuckets(period) {
  const buckets = [];
  let cursor = bucketStart(period.from, period.granularity);
  while (parseDate(cursor) <= parseDate(period.to)) {
    const end = bucketEnd(cursor, period.granularity);
    const from = parseDate(cursor) < parseDate(period.from) ? period.from : cursor;
    const to = parseDate(end) > parseDate(period.to) ? period.to : end;
    const clipped = from !== cursor || to !== end;
    const holdsToday = period.partialToday && to === period.today;
    buckets.push({ key: cursor, from, to, partial: clipped || holdsToday });
    cursor = addDays(end, 1);
  }
  return buckets;
}

// Folds rows grouped by UTC hour (`hour` as 'YYYY-MM-DD HH') into the local buckets, filling gaps with 0.
function foldHourlyRows(rows, period, valueKeys) {
  const buckets = buildBuckets(period).map((bucket) => ({
    ...bucket,
    ...Object.fromEntries(valueKeys.map((key) => [key, 0]))
  }));
  for (const row of Array.isArray(rows) ? rows : []) {
    const instant = Date.parse(`${String(row.hour).replace(' ', 'T')}:00:00Z`);
    if (!Number.isFinite(instant)) {
      continue;
    }
    const date = localDate(instant, period.timezone);
    const bucket = buckets.find((item) => date >= item.from && date <= item.to);
    if (!bucket) {
      continue;
    }
    for (const key of valueKeys) {
      bucket[key] += Number(row[key] || 0);
    }
  }
  return buckets;
}

module.exports = {
  GRANULARITIES,
  MAX_DAYS,
  REPORT_TIMEZONES,
  buildBuckets,
  foldHourlyRows,
  localDate,
  localMidnightUtc,
  publicPeriod,
  resolveReportPeriod,
  timezoneForMarket
};
