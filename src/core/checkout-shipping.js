// The freight the customer paid at checkout, read from the subscription's shipping snapshot. Only what an operator
// screen shows: never the quote token nor the whole snapshot. Nothing here recalculates it.
function numberOf(raw) {
  if (raw == null || raw === '') return null;
  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
}

function checkoutShippingOf(shipping) {
  if (!shipping || typeof shipping !== 'object' || Array.isArray(shipping)) return null;
  const cost = numberOf(shipping.cost);
  const label = String(shipping.label == null ? '' : shipping.label).trim();
  return {
    label: label || null,
    amount: cost != null ? cost : numberOf(shipping.total),
    currency: String(shipping.currency || 'BRL').toUpperCase(),
    distanceKm: numberOf(shipping.distance)
  };
}

module.exports = { checkoutShippingOf };
