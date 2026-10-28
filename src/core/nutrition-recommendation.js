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
  state: Object.freeze({ ...STATE_FACTORS }),
  base: Object.freeze({
    dog: 95,
    cat: 242,
    cat_overweight: 134,
    work_dog_high: 165,
    moderate_high_impact: 125,
    age_1_2: 130,
    age_3_7: 110,
    terranova: 105,
    dog_overweight: 80,
    dogue: 200,
    slow_metabolism: 95
  }),
  nem: Object.freeze({ dog: 3600, cat: 3800 }),
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

// The parameter set with its breed lists as sets, read once per calculation.
function resolveParameters(parameters) {
  const source = parameters || DEFAULT_NUTRITION_PARAMETERS;
  const groups = source.breed_groups || {};
  return {
    combination: source.combination,
    state: source.state,
    base: source.base,
    nem: source.nem,
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

function selectStateFactor(state, p) {
  if (!state) {
    return null;
  }

  if (state === 'CRESCIMENTO') {
    return p.state.CRESCIMENTO_81_100;
  }

  return has(p.state, state) ? p.state[state] : null;
}

function selectBaseFactor(species, breed, activity, score, age, workDog, highImpact, growthStage, p) {
  if (species === 'cat') {
    return score === 'ACIMA' ? p.base.cat_overweight : p.base.cat;
  }

  if (growthStage && has(p.state, growthStage)) {
    return p.state[growthStage];
  }

  if (activity === 'ALTO' && workDog) {
    return p.base.work_dog_high;
  }

  if (activity === 'MODERADO' && highImpact) {
    return p.base.moderate_high_impact;
  }

  if (age >= 1 && age <= 2) {
    return p.base.age_1_2;
  }

  if (age >= 3 && age <= 7) {
    return p.base.age_3_7;
  }

  if (p.groups.terranova.has(breed)) {
    return p.base.terranova;
  }

  if (score === 'ACIMA') {
    return p.base.dog_overweight;
  }

  return p.base.dog;
}

function selectFactor({
  species,
  weightKg,
  castrado,
  activity,
  score,
  breed,
  lifeStage,
  growthStage,
  age,
  workDog,
  highImpact
}, p) {
  const trace = [];
  const baseFactor = selectBaseFactor(species, breed, activity, score, age, workDog, highImpact, growthStage, p);
  let factor = baseFactor;
  trace.push(`base:${baseFactor}`);

  const stateFactor = selectStateFactor(lifeStage, p);
  if (stateFactor !== null) {
    factor = stateFactor;
    trace.push(`state_override:${lifeStage}:${stateFactor}`);
  }

  if (species === 'dog' && p.groups.dogue.has(breed)) {
    factor = p.base.dogue;
    trace.push(`breed_dogue_group:${factor}`);
  }

  if (species === 'dog' && p.groups.slow_metabolism.has(breed)) {
    factor = p.base.slow_metabolism;
    trace.push(`slow_metabolism_exception:${factor}`);
  }

  const combinationKey = `${castrado}-${activity}-${score}`;
  const hasCombination = has(p.combination, combinationKey);
  if (hasCombination) {
    factor = p.combination[combinationKey];
    trace.push(`combination_override:${combinationKey}:${factor}`);
  }

  if (species === 'cat' && score === 'ACIMA' && !hasCombination) {
    factor = p.base.cat_overweight;
    trace.push(`cat_obese_adjustment:${factor}`);
  }

  if (species === 'cat' && score !== 'ACIMA' && !hasCombination) {
    factor = p.base.cat;
    trace.push(`cat_normal_factor:${factor}`);
  }

  return { factor, trace };
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
  const age = Math.max(0, Number.parseInt(input.idade, 10) || 0);
  const workDog = sanitizeBoolean(input.work_dog) === true;
  const highImpact = sanitizeBoolean(input.high_impact) === true;
  const declaredSize = normalizeSize(input.porte);
  const resolvedSize = declaredSize || classifySize(species, weightKg);
  const factorDecision = selectFactor({
    species,
    weightKg,
    castrado,
    activity,
    score,
    breed,
    lifeStage,
    growthStage,
    age,
    workDog,
    highImpact
  }, p);
  const energyKcalDay = factorDecision.factor * (weightKg ** 0.75);
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
  DEFAULT_NUTRITION_PARAMETERS,
  normalizeText,
  buildForPet,
  calculateFood,
  resolveWeightKg
};
