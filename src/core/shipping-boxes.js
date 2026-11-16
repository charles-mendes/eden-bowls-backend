// Pure box plan of a cycle (shipping-boxes). `packs` is the `cyclePacks` output
// ([{ flavorKey, packSizeGrams, quantity }]); `boxes` is the settings `us.boxes`; `dryIceKg` is 0 for a BR cycle.
const LB_PER_KG = 2.20462;

function roundKg(value) {
  return Math.round(value * 1000) / 1000;
}

// UPS takes one decimal; a declared weight below the real one is billed later, so pounds round up.
function kgToLb(kg) {
  return Math.ceil(Math.round(kg * LB_PER_KG * 1e6) / 1e5) / 10;
}

// Heaviest packs first, so a split order fills its first boxes with the large packs.
function expandPacks(packs) {
  return (Array.isArray(packs) ? packs : [])
    .filter((pack) => Number(pack.quantity) > 0 && Number(pack.packSizeGrams) > 0)
    .map((pack, index) => ({ pack, index }))
    .sort((a, b) => Number(b.pack.packSizeGrams) - Number(a.pack.packSizeGrams) || a.index - b.index)
    .flatMap(({ pack }) => Array.from({ length: Number(pack.quantity) }, () => pack));
}

function groupPacks(units) {
  const grouped = [];
  for (const unit of units) {
    const last = grouped[grouped.length - 1];
    if (last && last.flavorKey === unit.flavorKey && last.packSizeGrams === Number(unit.packSizeGrams)) {
      last.quantity += 1;
    } else {
      grouped.push({ flavorKey: unit.flavorKey, packSizeGrams: Number(unit.packSizeGrams), quantity: 1 });
    }
  }
  return grouped;
}

function boxEntry(key, box, units, dryIceKg) {
  const grams = units.reduce((sum, unit) => sum + Number(unit.packSizeGrams), 0);
  const weightKg = roundKg(grams / 1000 + Number(box.empty_weight_kg) + dryIceKg);
  return {
    key,
    label: box.label,
    pack_count: units.length,
    packs: groupPacks(units),
    weight_kg: weightKg,
    weight_lb: kgToLb(weightKg),
    length_in: Number(box.length_in),
    width_in: Number(box.width_in),
    height_in: Number(box.height_in),
    dry_ice_kg: dryIceKg
  };
}

// While more packs remain than a monthly box holds, fill a monthly box; the rest goes in the Starter when it
// fits, otherwise in one more monthly box. 45 → 30 + 15, 40 → 30 + 10, 12 → 12, 8 → Starter.
function planBoxes({ packs, boxes, dryIceKg = 0 } = {}) {
  const starter = boxes && boxes.starter;
  const monthly = boxes && boxes.monthly;
  if (!starter || !monthly) {
    throw new Error('planBoxes needs the starter and monthly boxes.');
  }
  const starterMax = Number(starter.max_packs);
  const monthlyMax = Number(monthly.max_packs);
  const dryIce = Number(dryIceKg) > 0 ? Number(dryIceKg) : 0;
  const units = expandPacks(packs);
  const plan = [];
  let offset = 0;
  while (units.length - offset > monthlyMax) {
    plan.push(boxEntry('monthly', monthly, units.slice(offset, offset + monthlyMax), dryIce));
    offset += monthlyMax;
  }
  const rest = units.slice(offset);
  if (rest.length > 0) {
    plan.push(rest.length <= starterMax
      ? boxEntry('starter', starter, rest, dryIce)
      : boxEntry('monthly', monthly, rest, dryIce));
  }
  return plan;
}

module.exports = {
  kgToLb,
  planBoxes
};
