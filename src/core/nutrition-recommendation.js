const { convertWeight } = require('./market');

const COMBINATION_FACTORS = {
  'SIM-BAIXO-ABAIXO': 95,
  'SIM-BAIXO-ADEQUADO': 85,
  'SIM-BAIXO-ACIMA': 75,
  'SIM-ALTO-ABAIXO': 95,
  'SIM-ALTO-ADEQUADO': 95,
  'SIM-ALTO-ACIMA': 85,
  'SIM-MODERADO-ABAIXO': 95,
  'SIM-MODERADO-ADEQUADO': 85,
  'SIM-MODERADO-ACIMA': 75,
  'NAO-BAIXO-ABAIXO': 100,
  'NAO-BAIXO-ADEQUADO': 95,
  'NAO-BAIXO-ACIMA': 85,
  'NAO-ALTO-ABAIXO': 100,
  'NAO-ALTO-ADEQUADO': 95,
  'NAO-ALTO-ACIMA': 85,
  'NAO-MODERADO-ABAIXO': 85,
  'NAO-MODERADO-ADEQUADO': 95,
  'NAO-MODERADO-ACIMA': 85
};

// Giant dogs (over 40 kg, or a breed of the giant groups) in maintenance: the factors sent by the zootechnician
// Izabella (requerimento_energetico.md, "Fatores para raças gigantes").
const GIANT_COMBINATION_FACTORS = {
  'SIM-BAIXO-ABAIXO': 95,
  'SIM-BAIXO-ADEQUADO': 85,
  'SIM-BAIXO-ACIMA': 75,
  'SIM-ALTO-ABAIXO': 105,
  'SIM-ALTO-ADEQUADO': 95,
  'SIM-ALTO-ACIMA': 85,
  'SIM-MODERADO-ABAIXO': 100,
  'SIM-MODERADO-ADEQUADO': 90,
  'SIM-MODERADO-ACIMA': 80,
  'NAO-BAIXO-ABAIXO': 100,
  'NAO-BAIXO-ADEQUADO': 95,
  'NAO-BAIXO-ACIMA': 85,
  'NAO-ALTO-ABAIXO': 115,
  'NAO-ALTO-ADEQUADO': 105,
  'NAO-ALTO-ACIMA': 95,
  'NAO-MODERADO-ABAIXO': 105,
  'NAO-MODERADO-ADEQUADO': 100,
  'NAO-MODERADO-ACIMA': 90
};

// Exponent of the weight in the energy of the day: Fator × Peso^exponent.
const DOG_EXPONENT = 0.75;
const GIANT_MIN_WEIGHT_KG = 40;
const CAT_EXPONENT = 0.67;
const CAT_OBESE_EXPONENT = 0.4;

const STATE_FACTORS = {
  SENIOR: 95,
  GESTANTE: 132,
  CRESCIMENTO_ATE_50: 210,
  CRESCIMENTO_51_80: 175,
  CRESCIMENTO_81_100: 140
};

/**
 * Every number and breed list of the calculation, as the published nutrition parameter set stores them
 * (nutrition-parameters). The rules below keep their order; only these values are data. Breeds are normalized
 * (lower case, no accents).
 */
const DEFAULT_NUTRITION_PARAMETERS = Object.freeze({
  combination: Object.freeze({ ...COMBINATION_FACTORS }),
  combination_giant: Object.freeze({ ...GIANT_COMBINATION_FACTORS }),
  state: Object.freeze({ ...STATE_FACTORS }),
  // Cats (Tabela 1): indoor and active. An obese cat keeps the factor and changes the exponent.
  base: Object.freeze({
    cat: 60,
    cat_active: 100
  }),
  // EM do alimento (kcal/kg) when the recipe gives none: the fresh food of the adult recipes (1200 kcal/kg on every
  // adult label). There is no cat recipe; 1200 is the fresh-food example of the veterinarian's document.
  nem: Object.freeze({ dog: 1200, cat: 1200 }),
  breed_groups: Object.freeze({
    dogue: Object.freeze([
      'dogue alemao',
      'great dane',
      'irish wolfhound',
      'scottish deerhound',
      'borzoi',
      'greyhound',
      'anatolian',
      'anatolian shepherd',
      'leonberger'
    ]),
    slow_metabolism: Object.freeze(['sao bernardo', 'sao bernard', 'saint bernard']),
    terranova: Object.freeze(['terra nova', 'terranova', 'newfoundland'])
  })
});

const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

/**
 * A set saved before the calculation followed the veterinarian's document (requerimento_energetico.md), with the
 * values that document sets: the giant matrix, and the cat factors 60 and 100 in place of the old base section
 * (dog exceptions and cat 242/134), which the calculation no longer reads. A current set comes back unchanged.
 */
function upgradeNutritionParameters(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const base = source.base && typeof source.base === 'object' ? source.base : {};
  if (source.combination_giant && base.cat_active !== undefined) return source;
  return {
    ...source,
    combination_giant: { ...DEFAULT_NUTRITION_PARAMETERS.combination_giant },
    base: { ...DEFAULT_NUTRITION_PARAMETERS.base }
  };
}

// The parameter set with its breed lists as sets, read once per calculation.
function resolveParameters(parameters) {
  const source = upgradeNutritionParameters(parameters || DEFAULT_NUTRITION_PARAMETERS);
  const groups = source.breed_groups || {};
  const section = (name) => ({ ...DEFAULT_NUTRITION_PARAMETERS[name], ...(source[name] || {}) });
  return {
    combination: section('combination'),
    combination_giant: section('combination_giant'),
    state: section('state'),
    base: section('base'),
    nem: section('nem'),
    groups: {
      dogue: new Set((groups.dogue || []).map(normalizeText)),
      slow_metabolism: new Set((groups.slow_metabolism || []).map(normalizeText)),
      terranova: new Set((groups.terranova || []).map(normalizeText))
    }
  };
}

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function sanitizeBoolean(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = normalizeText(String(value));
  if (['1', 'true', 'yes', 'sim'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'nao'].includes(normalized)) {
    return false;
  }

  return null;
}

function normalizeSpecies(value) {
  const normalized = normalizeText(value);
  return normalized === 'gato' || normalized === 'cat' ? 'cat' : 'dog';
}

function normalizeCastrado(value) {
  if (typeof value === 'boolean') {
    return value ? 'SIM' : 'NAO';
  }

  const normalized = normalizeText(String(value ?? ''));
  if (['sim', 'yes', 'true', '1'].includes(normalized)) {
    return 'SIM';
  }

  return 'NAO';
}

function normalizeScore(value) {
  const normalized = normalizeText(value);
  if (['abaixo', 'magro', 'underweight'].includes(normalized)) {
    return 'ABAIXO';
  }

  if (['acima', 'obeso', 'sobrepeso', 'overweight'].includes(normalized)) {
    return 'ACIMA';
  }

  return 'ADEQUADO';
}

function normalizeState(value) {
  const normalized = normalizeText(value);
  if (['crescimento', 'filhote', 'puppy', 'kitten'].includes(normalized)) {
    return 'CRESCIMENTO';
  }

  if (['gestante', 'gestacao', 'pregnant'].includes(normalized)) {
    return 'GESTANTE';
  }

  if (['senior', 'idoso'].includes(normalized)) {
    return 'SENIOR';
  }

  return 'MANUTENCAO';
}

function normalizeGrowthStage(value) {
  const normalized = normalizeText(value);
  if (/(50|ate50|ate_50|up_to_50)/.test(normalized)) {
    return 'CRESCIMENTO_ATE_50';
  }

  if (/(51|80|51_80|51-80)/.test(normalized)) {
    return 'CRESCIMENTO_51_80';
  }

  if (/(81|100|81_100|81-100)/.test(normalized)) {
    return 'CRESCIMENTO_81_100';
  }

  return '';
}

function normalizeSize(value) {
  const normalized = normalizeText(value);
  if (['mini', 'toy'].includes(normalized)) {
    return 'mini';
  }

  if (['pequeno', 'small'].includes(normalized)) {
    return 'pequeno';
  }

  if (['medio', 'medium'].includes(normalized)) {
    return 'medio';
  }

  if (['grande', 'large'].includes(normalized)) {
    return 'grande';
  }

  if (['gigante', 'giant'].includes(normalized)) {
    return 'gigante';
  }

  return '';
}

function normalizeActivityLevel(value) {
  const normalized = normalizeText(value);

  if (/(alto|high|intenso|athlete|atleta|trabalho|working)/.test(normalized)) {
    return 'ALTO';
  }

  if (/(moderad|medio|medium|regular)/.test(normalized)) {
    return 'MODERADO';
  }

  return 'BAIXO';
}

function classifySize(species, weightKg) {
  if (species !== 'dog') {
    return '';
  }

  if (weightKg <= 5) {
    return 'mini';
  }

  if (weightKg <= 10) {
    return 'pequeno';
  }

  if (weightKg <= 25) {
    return 'medio';
  }

  if (weightKg <= 40) {
    return 'grande';
  }

  return 'gigante';
}

function resolveNemKcalPerKg(species, input, p) {
  const nemKg = Number(input.nem_kcal_kg || 0);
  if (nemKg > 0) {
    return nemKg;
  }

  const nem100 = Number(input.nem_kcal_100g || 0);
  if (nem100 > 0) {
    return nem100 * 10;
  }

  return species === 'cat' ? p.nem.cat : p.nem.dog;
}

function resolveMeals(species, lifeStage) {
  if (species === 'cat' || lifeStage === 'CRESCIMENTO') {
    return 3;
  }

  return 2;
}

// Giant (requerimento_energetico.md, "Porte dos cães"): over 40 kg whatever size the tutor declared, declared
// giant, or a breed of the giant groups.
function isGiantDog(size, breed, p, weightKg) {
  return weightKg > GIANT_MIN_WEIGHT_KG
    || size === 'gigante'
    || p.groups.dogue.has(breed)
    || p.groups.terranova.has(breed)
    || p.groups.slow_metabolism.has(breed);
}

/**
 * Factor and weight exponent of the energy of the day (requerimento_energetico.md):
 * - cat: 60 indoor, 100 with high activity; Peso^0,67, or Peso^0,4 when above weight. No combination matrix.
 * - dog growing, pregnant or senior: the stage factor of Tabela 1.
 * - adult dog in maintenance: the castrated × activity × body score matrix, the giant one for a dog over 40 kg or
 *   of a giant breed group (Dogue Alemão, Terra Nova, São Bernardo).
 * Dogs use Peso^0,75.
 */
function selectFactor({ species, castrado, activity, score, breed, lifeStage, growthStage, size, weightKg }, p) {
  const trace = [];

  if (species === 'cat') {
    const active = activity === 'ALTO';
    const factor = active ? p.base.cat_active : p.base.cat;
    trace.push(`${active ? 'cat_active' : 'cat_indoor'}:${factor}`);
    const exponent = score === 'ACIMA' ? CAT_OBESE_EXPONENT : CAT_EXPONENT;
    trace.push(`${score === 'ACIMA' ? 'cat_obese_exponent' : 'cat_exponent'}:${exponent}`);
    return { factor, exponent, trace };
  }

  if (lifeStage === 'CRESCIMENTO' || growthStage) {
    const key = growthStage && has(p.state, growthStage) ? growthStage : 'CRESCIMENTO_81_100';
    trace.push(`growth:${key}:${p.state[key]}`);
    return { factor: p.state[key], exponent: DOG_EXPONENT, trace };
  }

  if (lifeStage === 'GESTANTE' || lifeStage === 'SENIOR') {
    trace.push(`state:${lifeStage}:${p.state[lifeStage]}`);
    return { factor: p.state[lifeStage], exponent: DOG_EXPONENT, trace };
  }

  const key = `${castrado}-${activity}-${score}`;
  const giant = isGiantDog(size, breed, p, weightKg);
  const matrix = giant ? p.combination_giant : p.combination;
  trace.push(`${giant ? 'giant_combination' : 'combination'}:${key}:${matrix[key]}`);
  return { factor: matrix[key], exponent: DOG_EXPONENT, trace };
}

function localizedDisplayMetadata(locale) {
  const normalized = String(locale || '').trim().toLowerCase();
  if (normalized.startsWith('pt')) {
    return {
      energy_label: 'Energia',
      energy_unit: 'kcal/dia',
      food_label: 'Alimento',
      food_unit: 'g/dia',
      meals_label: 'Refeicoes/dia',
      per_meal_label: 'Por refeicao',
      per_meal_unit: 'g'
    };
  }

  return {
    energy_label: 'Energy',
    energy_unit: 'kcal/day',
    food_label: 'Food',
    food_unit: 'g/day',
    meals_label: 'Meals/day',
    per_meal_label: 'Per meal',
    per_meal_unit: 'g'
  };
}

function resolveWeightKg(pet = {}) {
  const amount = Number(pet.weight ?? pet.weight_input ?? pet.peso ?? 0);
  const unit = pet.weight_unit === 'lb' ? 'lb' : 'kg';
  return convertWeight(amount, unit, 'kg');
}

function calculateFood(input = {}, locale = '', parameters = DEFAULT_NUTRITION_PARAMETERS) {
  const p = resolveParameters(parameters);
  const weightKg = Math.max(0, Number(input.peso ?? 0));
  if (weightKg <= 0) {
    return {
      error: 'Peso invalido. Informe peso maior que zero.',
      display: localizedDisplayMetadata(locale)
    };
  }

  const species = normalizeSpecies(input.especie || 'cao');
  const castrado = normalizeCastrado(input.castrado);
  const activity = normalizeActivityLevel(input.nivel_atividade);
  const score = normalizeScore(input.score_corporal);
  const breed = normalizeText(input.raca);
  const lifeStage = normalizeState(input.estado_fisiologico || 'manutencao');
  const growthStage = normalizeGrowthStage(input.growth_stage);
  const declaredSize = normalizeSize(input.porte);
  const resolvedSize = declaredSize || classifySize(species, weightKg);
  const factorDecision = selectFactor({
    species,
    castrado,
    activity,
    score,
    breed,
    lifeStage,
    growthStage,
    size: resolvedSize,
    weightKg
  }, p);
  const energyKcalDay = factorDecision.factor * (weightKg ** factorDecision.exponent);
  const nemKcalKg = resolveNemKcalPerKg(species, input, p);
  const gramsDay = nemKcalKg > 0 ? Math.round((energyKcalDay / nemKcalKg) * 1000) : 0;
  const meals = resolveMeals(species, lifeStage);
  const gramsPerMeal = meals > 0 ? Math.round(gramsDay / meals) : 0;

  return {
    energia_kcal_dia: Math.round(energyKcalDay),
    quantidade_g_dia: gramsDay,
    refeicoes: meals,
    quantidade_por_refeicao: gramsPerMeal,
    fator_aplicado: Math.round(factorDecision.factor * 100) / 100,
    expoente_peso: factorDecision.exponent,
    porte: resolvedSize,
    especie: species,
    nem_kcal_kg: Math.round(nemKcalKg),
    decision_trace: factorDecision.trace,
    display: localizedDisplayMetadata(locale)
  };
}

function mapPetConditionToScore(petCondition) {
  const normalized = normalizeText(petCondition);
  if (normalized === 'underweight') {
    return 'ABAIXO';
  }

  if (normalized === 'overweight') {
    return 'ACIMA';
  }

  if (normalized === 'ideal') {
    return 'ADEQUADO';
  }

  return '';
}

function buildForPet(pet = {}, questionnaire = null, locale = '', parameters = DEFAULT_NUTRITION_PARAMETERS) {
  const questions = questionnaire && typeof questionnaire === 'object' ? questionnaire : {};
  const petCondition = normalizeText(pet.pet_condition);
  const mappedScore = mapPetConditionToScore(pet.pet_condition);
  const activityLevel = normalizeText(pet.activity_level);
  const ageYears = Math.max(0, Number.parseInt(pet.age_years ?? pet.age ?? 0, 10) || 0);
  const ageMonths = Math.max(0, Number.parseInt(pet.age_months ?? 0, 10) || 0);
  const weightKg = resolveWeightKg(pet);
  const result = calculateFood({
    especie: pet.type || pet.especie || 'dog',
    peso: weightKg,
    castrado: questions.castrado ?? pet.neutered ?? null,
    nivel_atividade: questions.nivel_atividade ?? questions.activity_level ?? activityLevel,
    score_corporal: questions.score_corporal || mappedScore,
    raca: pet.breed || '',
    porte: pet.size || questions.porte || '',
    estado_fisiologico: questions.estado_fisiologico || pet.life_stage || '',
    idade: ageYears,
    idade_meses: ageMonths,
    nem_kcal_kg: questions.nem_kcal_kg ?? questions.kcal_per_kg ?? null,
    nem_kcal_100g: questions.nem_kcal_100g ?? questions.kcal_per_100g ?? null,
    growth_stage: questions.growth_stage || '',
    work_dog: questions.work_dog ?? null,
    high_impact: questions.high_impact ?? null
  }, locale, parameters);

  result.pet_id = String(pet.id || pet.pet_id || '');
  result.pet_name = String(pet.name || pet.pet_name || '');
  result.pet = {
    id: String(pet.id || pet.pet_id || ''),
    name: String(pet.name || pet.pet_name || ''),
    type: String(pet.type || 'dog'),
    age: ageYears,
    age_years: ageYears,
    age_months: ageMonths,
    weight: Math.max(0, weightKg),
    breed: String(pet.breed || ''),
    size: String(pet.size || ''),
    activity_level: activityLevel,
    pet_condition: petCondition,
    weight_unit: String(pet.weight_unit || ''),
    neutered: sanitizeBoolean(pet.neutered)
  };

  return result;
}

module.exports = {
  COMBINATION_FACTORS,
  GIANT_COMBINATION_FACTORS,
  upgradeNutritionParameters,
  DEFAULT_NUTRITION_PARAMETERS,
  normalizeText,
  buildForPet,
  calculateFood,
  resolveWeightKg
};
