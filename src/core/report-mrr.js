// Every Stripe price bills monthly (recurring.interval 'month'), so the stored catalog subtotal is already
// the monthly charge before the first-purchase discount. Trialing rows are not billed yet and stay apart.
function toMinor(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : null;
}

function estimateMrr(rows = []) {
  let amount = 0;
  let trialingSubscriptions = 0;
  let unpricedSubscriptions = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row.status === 'trialing') {
      trialingSubscriptions += 1;
      continue;
    }
    const minor = toMinor(row.subtotal);
    if (minor === null) {
      unpricedSubscriptions += 1;
      continue;
    }
    amount += minor;
  }
  return { value: amount, previous: null, estimated: true, trialingSubscriptions, unpricedSubscriptions };
}

module.exports = {
  estimateMrr
};
