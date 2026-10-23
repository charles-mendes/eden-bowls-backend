// Lines are segregated: each stage buys only its own line, and a stage with no published recipe in the
// market buys adult, as before the launch (design decision 4).
function allowedLifeStages(lifeStage, publishedLines = new Set()) {
  if (lifeStage && publishedLines.has(lifeStage)) {
    return [lifeStage];
  }
  return ['adult'];
}

// Flavor keys a plan holds for one pet: its priced lines, else the pet's selected flavors.
function planFlavorsForPet(planSelection, petId) {
  const plan = planSelection && typeof planSelection === 'object' ? planSelection : {};
  const id = String(petId || '');
  const catalog = plan.catalog_pricing && typeof plan.catalog_pricing === 'object' ? plan.catalog_pricing : {};
  const priced = (Array.isArray(catalog.line_items) ? catalog.line_items : [])
    .filter((item) => item && String(item.pet_id || '') === id && Number(item.quantity) > 0)
    .map((item) => String(item.flavor || '').trim())
    .filter(Boolean);
  if (priced.length > 0) {
    return [...new Set(priced)];
  }
  const pet = (Array.isArray(plan.pets) ? plan.pets : []).find((item) => item && String(item.pet_id || item.id || '') === id);
  return pet && Array.isArray(pet.selected_flavors) ? [...new Set(pet.selected_flavors.map(String).filter(Boolean))] : [];
}

// Lines of the recipes a plan holds for a pet. Recipes without a stored line are adult (migration 034).
function planLinesForPet(planSelection, petId, lineByKey = {}) {
  return [...new Set(planFlavorsForPet(planSelection, petId).map((key) => lineByKey[key] || 'adult'))];
}

// Pets on a plan: enabled plan pets and every priced line's pet.
function planPetIds(planSelection) {
  const plan = planSelection && typeof planSelection === 'object' ? planSelection : {};
  const ids = new Set();
  for (const pet of Array.isArray(plan.pets) ? plan.pets : []) {
    const id = pet ? String(pet.pet_id || pet.id || '').trim() : '';
    if (pet && pet.enabled !== false && id) ids.add(id);
  }
  const catalog = plan.catalog_pricing && typeof plan.catalog_pricing === 'object' ? plan.catalog_pricing : {};
  for (const item of Array.isArray(catalog.line_items) ? catalog.line_items : []) {
    if (item && item.pet_id) ids.add(String(item.pet_id));
  }
  return [...ids];
}

function isOutsideAllowed(planLines, allowed) {
  return planLines.length > 0 && planLines.some((line) => !allowed.includes(line));
}

module.exports = {
  allowedLifeStages,
  isOutsideAllowed,
  planFlavorsForPet,
  planLinesForPet,
  planPetIds
};
