const { parseJsonColumn } = require('./stripe-subscription-map');

// The market that ships a subscription's boxes (shipment-market): BR when the Stripe account is `br` and the
// stored address country is BR, US for `us` and US. Any other pair, an empty country included, fits no market.
// The country is read as stored: a default here would turn a `us` account without a country into a US shipment.
function storedCountry(address) {
  const value = parseJsonColumn(address) || {};
  return String(value.country == null ? '' : value.country).trim().toUpperCase();
}

function shipmentMarket({ stripeAccount, address } = {}) {
  const account = String(stripeAccount || '').trim().toLowerCase();
  const country = storedCountry(address);
  if (account === 'br' && country === 'BR') return { market: 'BR', exception: false };
  if (account === 'us' && country === 'US') return { market: 'US', exception: false };
  return { market: null, exception: true };
}

// The same rule in SQL, for queries over the ledger queue source (`q.address` JSON, `q.stripe_account`).
function shipmentMarketSql(market, alias = 'q') {
  const country = `UPPER(TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(${alias}.address, '$.country')), '')))`;
  const account = market === 'BR' ? 'br' : 'us';
  return `(${alias}.stripe_account = '${account}' AND ${country} = '${market === 'BR' ? 'BR' : 'US'}')`;
}

// Neither pair: the exceptions list.
function marketExceptionSql(alias = 'q') {
  return `NOT (${shipmentMarketSql('BR', alias)} OR ${shipmentMarketSql('US', alias)})`;
}

module.exports = {
  shipmentMarket,
  shipmentMarketSql,
  marketExceptionSql,
  storedCountry
};
