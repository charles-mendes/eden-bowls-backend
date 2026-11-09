const { planPetIds } = require('./life-stage-lines');

// Statuses in which a subscription still holds its pets (admin-customer-subscriptions). past_due keeps feeding
// the pet; paused and incomplete still make the checkout refuse a new subscription for it. canceled also holds
// incomplete_expired in the ledger. Kept apart from the checkout's list on purpose: changing that rule must not
// change what the customer detail shows without going through the spec.
const OWNING_STATUSES = new Set(['active', 'trialing', 'past_due', 'paused', 'incomplete']);

function objectOr(value) {
  return value && typeof value === 'object' ? value : {};
}

function petId(pet) {
  return pet ? String(pet.pet_id || pet.id || '').trim() : '';
}

// The pets a ledger row owns, as [{ id, name }]. The plan decides; the pets snapshot is used only when the plan
// lists no pet at all (enabled or not) and no priced line, so a plan whose pets are all disabled owns nothing.
function ownedPets(row) {
  if (!row || !OWNING_STATUSES.has(String(row.status || ''))) {
    return [];
  }

  const plan = objectOr(row.planSelection);
  const planPets = Array.isArray(plan.pets) ? plan.pets.filter(Boolean) : [];
  const lineItems = Array.isArray(objectOr(plan.catalog_pricing).line_items) ? plan.catalog_pricing.line_items : [];
  const snapshot = objectOr(row.petsSnapshot);
  const snapshotPets = Array.isArray(snapshot.pets) ? snapshot.pets.filter(Boolean) : [];

  let ids;
  if (planPets.length === 0 && lineItems.length === 0) {
    ids = [...new Set((Array.isArray(snapshot.pet_ids) ? snapshot.pet_ids : []).map((id) => String(id).trim()).filter(Boolean))];
  } else {
    const disabled = new Set(planPets.filter((pet) => pet.enabled === false).map(petId).filter(Boolean));
    ids = planPetIds(plan).filter((id) => !disabled.has(id));
  }

  return ids.map((id) => {
    const planPet = planPets.find((pet) => petId(pet) === id);
    const snapshotPet = snapshotPets.find((pet) => petId(pet) === id);
    const name = (planPet && (planPet.pet_name || planPet.name)) || (snapshotPet && (snapshotPet.name || snapshotPet.pet_name)) || '';
    return { id, name: String(name) };
  });
}

function compareNewestFirst(left, right) {
  const leftTime = Date.parse(left.createdAt || '') || 0;
  const rightTime = Date.parse(right.createdAt || '') || 0;
  if (leftTime !== rightTime) {
    return rightTime - leftTime;
  }
  return (Number(right.id) || 0) - (Number(left.id) || 0);
}

// The ledger rows that own the pet, newest first (createdAt, then id).
function petSubscriptions(id, rows) {
  const target = String(id == null ? '' : id).trim();
  if (!target) {
    return [];
  }
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => ownedPets(row).some((pet) => pet.id === target))
    .sort(compareNewestFirst);
}

module.exports = {
  OWNING_STATUSES,
  ownedPets,
  petSubscriptions
};
