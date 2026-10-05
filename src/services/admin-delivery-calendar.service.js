const { HttpError } = require('../core/http-error');

const MARKETS = ['BR', 'US'];

function parseYear(value) {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new HttpError(422, 'Ano inválido.', { code: 'invalid_year' });
  }
  return year;
}

// One market per request: the panel always edits a single market's calendar.
function singleMarket(marketQuery) {
  const market = marketQuery && marketQuery.market;
  if (!MARKETS.includes(market)) {
    throw new HttpError(422, 'Informe o mercado (BR ou US).', { code: 'market_required' });
  }
  return market;
}

class AdminDeliveryCalendarService {
  constructor(options = {}) {
    this.calendarRepository = options.calendarRepository;
  }

  async listYear({ marketQuery, year }) {
    const market = singleMarket(marketQuery);
    const parsedYear = parseYear(year);
    const items = await this.calendarRepository.listYear(market, parsedYear);
    return { market, year: parsedYear, items };
  }
}

module.exports = {
  AdminDeliveryCalendarService,
  parseYear,
  singleMarket
};
