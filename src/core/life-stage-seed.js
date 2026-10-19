// Stage limits and giant breeds approved by the veterinarian on 2026-10-18 (L-01).
// Source: docs/life-stage/breeds-life-stage.csv and docs/life-stage/README.md. The API reads these values
// from the database; this module only seeds them, the same for every market.

const LIFE_STAGE_MARKETS = ['BR', 'US'];
const SIZE_CLASSES = ['small', 'medium', 'large', 'giant'];

const SIZE_CLASS_LIMITS = [
  { sizeClass: 'small', adultFromMonths: 10, seniorFromMonths: 120 },
  { sizeClass: 'medium', adultFromMonths: 12, seniorFromMonths: 96 },
  { sizeClass: 'large', adultFromMonths: 15, seniorFromMonths: 84 },
  { sizeClass: 'giant', adultFromMonths: 18, seniorFromMonths: 72 }
];

// One entry per distinct [Portuguese, English] name of the CSV rows marked giant. Duplicate rows collapse.
const GIANT_BREEDS = [
  ['Dogue Alemão', 'Great Dane'],
  ['São Bernardo', 'Saint Bernard'],
  ['Boiadeiro de Berna', 'Bernese Mountain Dog'],
  ['Newfoundland', 'Newfoundland'],
  ['Komondor', 'Komondor'],
  ['Mastim Tibetano', 'Tibetan Mastiff'],
  ['Lobeiro Irlandês', 'Irish Wolfhound'],
  ['Deerhound Escocês', 'Scottish Deerhound'],
  ['Boerboel', 'Boerboel'],
  ['Fila Brasileiro', 'Brazilian Mastiff'],
  ['Cane Corso', 'Cane Corso'],
  ['Mastim Napolitano', 'Neapolitan Mastiff'],
  ['Bullmastiff', 'Bullmastiff'],
  ['Mastim Inglês', 'English Mastiff'],
  ['Tosa Inu', 'Tosa Inu'],
  ['Leonberger', 'Leonberger'],
  ['Kangal', 'Kangal'],
  ['Pastor da Anatólia', 'Anatolian Shepherd'],
  ['Cão de Montanha dos Pireneus', 'Pyrenean Mountain Dog'],
  ['Karabash da Anatólia', 'Anatolian Karabash'],
  ['Terrier Preto Russo', 'Black Russian Terrier'],
  ['Broholmer', 'Broholmer'],
  ['Pastor da Bucovina', 'Bucovina Shepherd'],
  ['Pastor da Ásia Central', 'Central Asian Shepherd'],
  ['Cão da Serra da Estrela', 'Estrela Mountain Dog'],
  ['Cão de Montanha dos Pireneus', 'Great Pyrenees'],
  ['Greater Swiss Mountain Dog', 'Greater Swiss Mountain Dog'],
  ['Landseer', 'Landseer'],
  ['Dogue de Canário', 'Perro de Presa Canario'],
  ['Rafeiro do Alentejo', 'Rafeiro do Alentejo'],
  ['Mastim Espanhol', 'Spanish Mastiff'],
  ['Aksaray Malaklisi', 'Aksaray Malaklisi'],
  ['Mastim Americano', 'American Mastiff'],
  ['Lobeiro Buriato-Mongol', 'Buryat-Mongolian Wolfhound'],
  ['Kangal Shepherd Dog', 'Kangal Shepherd Dog'],
  ['Cão de Guarda de Moscou', 'Moscow Watchdog'],
  ['Sarplaninac', 'Sarplaninac'],
  ['Cão de Sharplanina', 'Sharplanina Dog'],
  ['Ovcharka do Sul da Rússia', 'South Russian Ovcharka'],
  ['Bully Kutta', 'Bully Kutta'],
  ['Cão da Serra da Estrela (Pelo Curto)', 'Estrela Mountain Dog (Short Hair)'],
  ['Cão da Serra da Estrela (Pelo Comprido)', 'Estrela Mountain Dog (Long Hair)'],
  ['Cão de Gado Transmontano', 'Transmontano Cattle Dog'],
  ['Pastor do Cáucaso', 'Caucasian Shepherd'],
  ['Pastor da Rússia Meridional', 'South Russian Ovcharka'],
  ['Pastor de Bucovina', 'Bucovina Shepherd'],
  ['Pastor de Sharplanina', 'Sharplanina Shepherd']
];

function normalizeBreedName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function buildSizeClassSeedRows() {
  return LIFE_STAGE_MARKETS.flatMap((market) => SIZE_CLASS_LIMITS.map((limit) => ({ market, ...limit })));
}

function buildBreedSeedRows() {
  return LIFE_STAGE_MARKETS.flatMap((market) => GIANT_BREEDS.map(([namePt, nameEn]) => ({
    market,
    namePt,
    nameEn,
    namePtNormalized: normalizeBreedName(namePt),
    nameEnNormalized: normalizeBreedName(nameEn),
    sizeClass: 'giant'
  })));
}

module.exports = {
  GIANT_BREEDS,
  LIFE_STAGE_MARKETS,
  SIZE_CLASSES,
  SIZE_CLASS_LIMITS,
  buildBreedSeedRows,
  buildSizeClassSeedRows,
  normalizeBreedName
};
