function parseNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeDraftPet(pet = {}) {
  const id = String(pet.pet_id || pet.id || '').trim();
  const name = String(pet.name || pet.pet_name || '').trim();
  const weight = parseNumber(pet.weight ?? pet.weight_input, 0);
  const ageYears = parseNumber(pet.age_years ?? pet.age, 0);
  const ageMonths = parseNumber(pet.age_months, 0);

  return {
    id,
    pet_id: id,
    name,
    pet_name: name,
    breed: String(pet.breed || '').trim(),
    age_years: ageYears,
    age_months: ageMonths,
    age: ageYears,
    weight,
    weight_input: weight,
    weight_unit: pet.weight_unit === 'lb' ? 'lb' : 'kg',
    size: String(pet.size || '').trim(),
    activity_level: String(pet.activity_level || '').trim(),
    pet_condition: String(pet.pet_condition || '').trim(),
    neutered: Boolean(pet.neutered)
  };
}

function normalizeDraftPets(pets) {
  if (!Array.isArray(pets)) {
    return [];
  }

  return pets
    .filter((pet) => pet && typeof pet === 'object')
    .map(normalizeDraftPet);
}

function petHasNutritionalProfile(pet) {
  return Number(pet && (pet.weight ?? pet.weight_input)) > 0;
}

module.exports = {
  normalizeDraftPet,
  normalizeDraftPets,
  petHasNutritionalProfile
};
