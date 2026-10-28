// Pure stock math over production queue cycles (pack-stock). A cycle here is
// { key, subscriptionId, periodEnd, dueAt, productionStatus, paymentState, lineItems }, with the line items the
// queue presenter shows ({ flavorKey, flavor, packSizeGrams, quantity }).

// Ready cycles were already separated and blocked ones left the week, so only these still need packs.
const COMMITTING_STATUSES = new Set(['to_prepare', 'in_production']);

function stockKey(flavorKey, packSizeGrams) {
  return `${flavorKey}|${packSizeGrams}`;
}

function commits(cycle) {
  return COMMITTING_STATUSES.has(String(cycle && cycle.productionStatus));
}

function unsizedLine(cycle, line) {
  return {
    subscriptionId: cycle.subscriptionId,
    periodEnd: cycle.periodEnd || null,
    flavorKey: line.flavorKey || null,
    label: line.flavor || line.flavorKey || '',
    quantity: Number(line.quantity) || 0
  };
}

// One cycle's packs per recipe and grams (pets summed), and the lines without a size.
function cyclePacks(cycle) {
  const packs = new Map();
  const unsized = [];
  for (const line of Array.isArray(cycle.lineItems) ? cycle.lineItems : []) {
    const quantity = Number(line.quantity) || 0;
    if (quantity <= 0) {
      continue;
    }
    const grams = Number(line.packSizeGrams);
    if (!line.flavorKey || !Number.isInteger(grams) || grams <= 0) {
      unsized.push(unsizedLine(cycle, line));
      continue;
    }
    const key = stockKey(line.flavorKey, grams);
    const current = packs.get(key) || { flavorKey: line.flavorKey, packSizeGrams: grams, quantity: 0 };
    current.quantity += quantity;
    packs.set(key, current);
  }
  return { packs: [...packs.values()], unsized };
}

// What the committing cycles need per item, the part still awaiting payment, and the lines left out.
function sumDemand(cycles = []) {
  const demand = new Map();
  const unsized = [];
  for (const cycle of cycles) {
    if (!commits(cycle)) {
      continue;
    }
    const awaitingPayment = cycle.paymentState !== 'paid';
    const result = cyclePacks(cycle);
    unsized.push(...result.unsized);
    for (const pack of result.packs) {
      const key = stockKey(pack.flavorKey, pack.packSizeGrams);
      const current = demand.get(key) || {
        flavorKey: pack.flavorKey,
        packSizeGrams: pack.packSizeGrams,
        committed: 0,
        committedAwaitingPayment: 0
      };
      current.committed += pack.quantity;
      if (awaitingPayment) {
        current.committedAwaitingPayment += pack.quantity;
      }
      demand.set(key, current);
    }
  }
  return { demand, unsized };
}

// Every stored item and every item with demand, with what is free and what still has to be produced.
function buildOverview({ stockItems = [], cycles = [] }) {
  const { demand, unsized } = sumDemand(cycles);
  const rows = new Map();
  for (const item of stockItems) {
    rows.set(stockKey(item.flavorKey, item.packSizeGrams), {
      flavorKey: item.flavorKey,
      packSizeGrams: item.packSizeGrams,
      onHand: Number(item.onHand) || 0,
      minLevel: item.minLevel == null ? null : Number(item.minLevel)
    });
  }
  for (const [key, entry] of demand) {
    if (!rows.has(key)) {
      rows.set(key, { flavorKey: entry.flavorKey, packSizeGrams: entry.packSizeGrams, onHand: 0, minLevel: null });
    }
  }

  const items = [...rows.entries()].map(([key, row]) => {
    const entry = demand.get(key);
    const committed = entry ? entry.committed : 0;
    const available = row.onHand - committed;
    return {
      ...row,
      committed,
      committedAwaitingPayment: entry ? entry.committedAwaitingPayment : 0,
      available,
      toProduce: Math.max(0, -available),
      belowMinimum: row.minLevel != null && available < row.minLevel
    };
  });
  items.sort((left, right) => (left.flavorKey === right.flavorKey
    ? left.packSizeGrams - right.packSizeGrams
    : (left.flavorKey < right.flavorKey ? -1 : 1)));

  return { items, unsizedLines: unsized };
}

function dueTime(cycle) {
  const time = new Date(cycle.dueAt || cycle.periodEnd || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

// Allots on-hand to the committing cycles in due order (then subscription id). A cycle is short when any of
// its packs is not fully allotted, and unknown when it has a line without a size.
function allocateCoverage({ stockItems = [], cycles = [] }) {
  const remaining = new Map(stockItems.map((item) => [stockKey(item.flavorKey, item.packSizeGrams), Number(item.onHand) || 0]));
  const coverage = new Map();
  const ordered = cycles
    .filter(commits)
    .slice()
    .sort((left, right) => (dueTime(left) - dueTime(right)) || (Number(left.subscriptionId) - Number(right.subscriptionId)));

  for (const cycle of ordered) {
    const { packs, unsized } = cyclePacks(cycle);
    let short = false;
    for (const pack of packs) {
      const key = stockKey(pack.flavorKey, pack.packSizeGrams);
      const left = (remaining.get(key) || 0) - pack.quantity;
      remaining.set(key, left);
      if (left < 0) {
        short = true;
      }
    }
    coverage.set(cycle.key, unsized.length ? 'unknown' : (short ? 'short' : 'covered'));
  }
  return coverage;
}

module.exports = {
  COMMITTING_STATUSES,
  allocateCoverage,
  buildOverview,
  cyclePacks,
  stockKey,
  sumDemand
};
