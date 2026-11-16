const { DEFAULT_OPERATING_WEEK, WEEKDAYS } = require('../../core/delivery-closed-days');

const TABLE = 'delivery_operating_week';
const MARKETS = ['BR', 'US'];

function hhmm(value) {
  return String(value || '').slice(0, 5);
}

// Seven days, Monday first. A weekday missing from the table reads as the default, so a partial table never
// leaves a hole in the week.
function weekFromRows(market, rows) {
  const byDay = new Map(rows.filter((row) => row.market === market).map((row) => [Number(row.weekday), row]));
  return WEEKDAYS.map((weekday) => {
    const row = byDay.get(weekday);
    if (!row) return { ...DEFAULT_OPERATING_WEEK[market][weekday - 1] };
    return {
      weekday,
      open: row.open === true || Number(row.open) === 1,
      opensAt: hhmm(row.opens_at),
      closesAt: hhmm(row.closes_at)
    };
  });
}

class OperatingWeekRepository {
  constructor(dataSource) {
    this.dataSource = dataSource;
  }

  async rows(executor) {
    return (executor || this.dataSource).query(
      `SELECT market, weekday, open, opens_at, closes_at FROM \`${TABLE}\` ORDER BY market, weekday`
    );
  }

  async get(market, executor) {
    return weekFromRows(market, await this.rows(executor));
  }

  async getBoth(executor) {
    const rows = await this.rows(executor);
    return Object.fromEntries(MARKETS.map((market) => [market, weekFromRows(market, rows)]));
  }

  // Replaces the seven days of one market, inside the caller's transaction.
  async saveIn(manager, market, days) {
    const values = days.map(() => '(?, ?, ?, ?, ?)').join(', ');
    await manager.query(
      `INSERT INTO \`${TABLE}\` (\`market\`, \`weekday\`, \`open\`, \`opens_at\`, \`closes_at\`) VALUES ${values}
       ON DUPLICATE KEY UPDATE \`open\` = VALUES(\`open\`), \`opens_at\` = VALUES(\`opens_at\`), \`closes_at\` = VALUES(\`closes_at\`)`,
      days.flatMap((day) => [market, day.weekday, day.open ? 1 : 0, `${day.opensAt}:00`, `${day.closesAt}:00`])
    );
    return weekFromRows(market, days.map((day) => ({
      market, weekday: day.weekday, open: day.open, opens_at: day.opensAt, closes_at: day.closesAt
    })));
  }
}

module.exports = {
  OperatingWeekRepository,
  weekFromRows
};
