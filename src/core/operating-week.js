const { HttpError } = require('./http-error');
const { DEFAULT_OPERATING_WEEK, WEEKDAYS } = require('./delivery-closed-days');

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
// The weekdays whose preparation can reach a weekday UPS pickup the next day: Sunday (7) to Thursday (4).
const US_PICKUP_WEEKDAYS = new Set([7, 1, 2, 3, 4]);

function invalidHours(message) {
  return new HttpError(422, message, { code: 'invalid_week_hours' });
}

// A proposed standard week (delivery-calendar): seven days, Monday first, as stored. A closed day may omit its
// hours; it keeps the default ones. An open day needs `opensAt` earlier than `closesAt`.
function parseWeek(market, days) {
  if (!Array.isArray(days) || days.length !== WEEKDAYS.length) {
    throw invalidHours('Informe os sete dias da semana.');
  }
  const byDay = new Map();
  for (const day of days) {
    const weekday = Number(day && day.weekday);
    if (!WEEKDAYS.includes(weekday) || byDay.has(weekday)) {
      throw invalidHours('Informe cada dia da semana uma vez, de segunda (1) a domingo (7).');
    }
    byDay.set(weekday, day);
  }
  const week = WEEKDAYS.map((weekday) => {
    const day = byDay.get(weekday);
    const fallback = DEFAULT_OPERATING_WEEK[market][weekday - 1];
    const open = day.open === true;
    const opensAt = day.opensAt == null && !open ? fallback.opensAt : String(day.opensAt || '');
    const closesAt = day.closesAt == null && !open ? fallback.closesAt : String(day.closesAt || '');
    if (!HHMM.test(opensAt) || !HHMM.test(closesAt)) {
      throw invalidHours('Use horários no formato HH:MM.');
    }
    if (open && opensAt >= closesAt) {
      throw invalidHours('A abertura precisa ser antes do fechamento.');
    }
    return { weekday, open, opensAt, closesAt };
  });
  if (!week.some((day) => day.open)) {
    throw new HttpError(422, 'Abra pelo menos um dia da semana.', { code: 'week_without_preparation' });
  }
  if (market === 'US' && !week.some((day) => day.open && US_PICKUP_WEEKDAYS.has(day.weekday))) {
    throw new HttpError(422, 'Nos EUA, abra pelo menos um dia de domingo a quinta: só eles têm coleta UPS em dia útil.', {
      code: 'week_without_preparation'
    });
  }
  return week;
}

module.exports = {
  parseWeek
};
