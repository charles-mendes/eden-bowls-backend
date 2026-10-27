// Recipe labels from the veterinarian's files (docs-new/ARQUIVOS_VETERINARIA_CALCULOS/rotulos). The adult
// recipes reuse the text the store already shows from its recipe Markdown; the puppy and senior BR text is
// a translation of the US label in the same wording.

const ANALYSIS_NUTRIENTS = {
  US: ['Crude Protein (min)', 'Crude Fat (min)', 'Crude Fiber (max)', 'Moisture (max)', 'Calcium (min)', 'Calcium (max)', 'Phosphorus (min)'],
  BR: ['Proteína bruta (mín)', 'Gordura bruta (mín)', 'Fibra bruta (máx)', 'Umidade (máx)', 'Cálcio (mín)', 'Cálcio (máx)', 'Fósforo (mín)']
};

const SHARED = {
  US: {
    productPrefix: 'Fresh Frozen Dog Food – ',
    netWeight: 'Net Wt. 10.6 oz (300 g)',
    freshnessNote: 'Flash Frozen for Freshness',
    supplement: 'Vitamin and Mineral Supplement',
    notices: [
      'This product is intended for intermittent or supplemental feeding only.',
      'Not formulated to meet AAFCO nutrient profiles for complete and balanced nutrition.'
    ],
    storage: [
      'Keep frozen. Thaw under refrigeration. Use within 4 days.',
      'Do not refreeze.',
      'Always provide fresh water.'
    ],
    feeding: [
      'Feed as part of a balanced diet.',
      'Divide into multiple meals for puppies.',
      "Adjust portion according to your dog's age, size, and activity level."
    ]
  },
  BR: {
    productPrefix: 'Alimento fresco congelado para cães – ',
    netWeight: 'Peso líquido 10,6 oz (300 g)',
    freshnessNote: 'Congelado rapidamente para preservar o frescor',
    supplement: 'Suplemento vitamínico e mineral',
    notices: [
      'Este produto destina-se apenas à alimentação intermitente ou suplementar.',
      'Não formulado para atender aos perfis nutricionais AAFCO de nutrição completa e balanceada.'
    ],
    storage: [
      'Manter congelado. Descongelar sob refrigeração. Consumir em até 4 dias.',
      'Não recongele.',
      'Sempre ofereça água fresca.'
    ],
    feeding: [
      'Ofereça como parte de uma dieta equilibrada.',
      'Divida em várias refeições para filhotes.',
      'Ajuste a porção de acordo com a idade, o porte e o nível de atividade do seu cão.'
    ]
  }
};

// Per recipe key (recipe_contents.flavor_slug): kcal/kg, kcal per 300 g package, the seven analysis values
// in ANALYSIS_NUTRIENTS order, and per market the recipe name in the admin (title), the product name and
// the ingredients. `{supplement}` marks where the
// vitamin and mineral supplement sits in the ingredient list.
const RECIPE_LABELS = {
  beef: {
    energyKg: 1200,
    energyPackage: 360,
    analysis: [9.0, 3.0, 1.3, 74.0, 0.15, 0.30, 0.16],
    US: { title: 'Beef', name: 'Beef Recipe', ingredients: ['Potatoes', 'Beef', 'White Rice', 'Carrots', 'Eggplant', 'Spinach', '{supplement}', 'Canola Oil', 'Sunflower Oil', 'Salt'] },
    BR: { title: 'Bovino', name: 'Receita de Carne Bovina', ingredients: ['Batatas', 'Carne bovina', 'Arroz branco', 'Cenoura', 'Berinjela', 'Espinafre', '{supplement}', 'Óleo de canola', 'Óleo de girassol', 'Sal'] }
  },
  turkey: {
    energyKg: 1200,
    energyPackage: 360,
    analysis: [9.0, 3.0, 1.5, 79.0, 0.15, 0.28, 0.17],
    US: { title: 'Chicken', name: 'Chicken Recipe', ingredients: ['Cassava', 'Chicken', 'Kabocha Squash', 'Green Beans', 'Broccoli', 'Quinoa', '{supplement}', 'Canola Oil', 'Sunflower Oil', 'Salt'] },
    BR: { title: 'Frango', name: 'Receita de Frango', ingredients: ['Mandioca', 'Frango', 'Abóbora Cabotiá', 'Vagem', 'Brócolis', 'Quinoa', '{supplement}', 'Óleo de canola', 'Óleo de girassol', 'Sal'] }
  },
  fish: {
    energyKg: 1200,
    energyPackage: 360,
    analysis: [9.0, 3.0, 2.3, 79.0, 0.16, 0.30, 0.18],
    US: { title: 'Fish', name: 'Fish Recipe', ingredients: ['Sweet Potatoes', 'Tilapia', 'Carrots', 'Zucchini', 'Cauliflower', 'Oats', '{supplement}', 'Canola Oil', 'Sunflower Oil', 'Coconut Oil', 'Chia Flour', 'Ground Ginger', 'Salt'] },
    BR: { title: 'Peixe', name: 'Receita de Peixe', ingredients: ['Batata-doce', 'Tilápia', 'Cenoura', 'Abobrinha', 'Couve-flor', 'Aveia', '{supplement}', 'Óleo de canola', 'Óleo de girassol', 'Óleo de coco', 'Farinha de chia', 'Gengibre em pó', 'Sal'] }
  },
  pork: {
    energyKg: 1200,
    energyPackage: 360,
    analysis: [9.0, 3.0, 3.0, 78.0, 0.15, 0.29, 0.20],
    US: { title: 'Pork', name: 'Pork Recipe', ingredients: ['Sweet Potatoes', 'Pork', 'Lentils', 'Green Peas', 'Green Beans', 'Collard Greens', '{supplement}', 'Canola Oil', 'Sunflower Oil', 'Salt'] },
    BR: { title: 'Porco', name: 'Receita de Porco', ingredients: ['Batata-doce', 'Carne suína', 'Lentilha', 'Ervilha', 'Vagem', 'Couve', '{supplement}', 'Óleo de canola', 'Óleo de girassol', 'Sal'] }
  },
  'puppy-beef-chicken': {
    energyKg: 1500,
    energyPackage: 450,
    analysis: [11.0, 5.0, 2.3, 72.0, 0.20, 0.37, 0.23],
    US: { title: 'Beef & Chicken Puppy', name: 'Beef & Chicken Puppy Recipe', ingredients: ['Brown Rice', 'Beef', 'Lentils', 'Zucchini', 'Carrots', 'Chicken', 'Canola Oil', 'Oats', '{supplement}', 'Sunflower Oil', 'Salt'] },
    BR: { title: 'Filhote Bovino e Frango', name: 'Receita de Carne Bovina e Frango para Filhotes', ingredients: ['Arroz integral', 'Carne bovina', 'Lentilha', 'Abobrinha', 'Cenoura', 'Frango', 'Óleo de canola', 'Aveia', '{supplement}', 'Óleo de girassol', 'Sal'] }
  },
  'puppy-chicken-pork': {
    energyKg: 1500,
    energyPackage: 450,
    analysis: [12.0, 6.0, 1.7, 74.0, 0.20, 0.37, 0.23],
    US: { title: 'Chicken & Pork Puppy', name: 'Chicken & Pork Puppy Recipe', ingredients: ['Chicken', 'Brown Rice', 'Kabocha Squash', 'Pork', 'Zucchini', 'Green Peas', 'Cauliflower', 'Oats', 'Canola Oil', '{supplement}', 'Salt'] },
    BR: { title: 'Filhote Frango e Porco', name: 'Receita de Frango e Porco para Filhotes', ingredients: ['Frango', 'Arroz integral', 'Abóbora Cabotiá', 'Carne suína', 'Abobrinha', 'Ervilha', 'Couve-flor', 'Aveia', 'Óleo de canola', '{supplement}', 'Sal'] }
  },
  'senior-beef': {
    energyKg: 1150,
    energyPackage: 345,
    analysis: [10.0, 4.0, 1.1, 79.0, 0.16, 0.30, 0.18],
    US: { title: 'Senior Beef', name: 'Beef Recipe for Mature Dogs', ingredients: ['Beef', 'Potatoes', 'Green Beans', 'White Rice', 'Eggs', 'Broccoli', 'Collard Greens', '{supplement}', 'Canola Oil', 'Salt'] },
    BR: { title: 'Sênior Bovino', name: 'Receita de Carne Bovina para Cães Sênior', ingredients: ['Carne bovina', 'Batatas', 'Vagem', 'Arroz branco', 'Ovos', 'Brócolis', 'Couve', '{supplement}', 'Óleo de canola', 'Sal'] }
  },
  'senior-chicken': {
    energyKg: 1150,
    energyPackage: 345,
    analysis: [10.0, 4.0, 1.3, 79.0, 0.15, 0.28, 0.19],
    US: { title: 'Senior Chicken', name: 'Chicken Recipe for Mature Dogs', ingredients: ['Chicken Thigh (Skinless)', 'Sweet Potato', 'White Rice', 'Carrots', 'Zucchini', 'Kabocha Squash', '{supplement}', 'Canola Oil', 'Salt'] },
    BR: { title: 'Sênior Frango', name: 'Receita de Frango para Cães Sênior', ingredients: ['Sobrecoxa de frango (sem pele)', 'Batata-doce', 'Arroz branco', 'Cenoura', 'Abobrinha', 'Abóbora Cabotiá', '{supplement}', 'Óleo de canola', 'Sal'] }
  }
};

// "1,200" / "0.15%" in the US, "1.200" / "0,15%" in BR, as the store Markdown writes them.
function formatEnergy(kcal, market) {
  return kcal.toLocaleString('en-US').replace(',', market === 'BR' ? '.' : ',');
}

function formatPercent(value, market) {
  const text = value < 1 ? value.toFixed(2) : value.toFixed(1);
  return `${market === 'BR' ? text.replace('.', ',') : text}%`;
}

// Label in the shape parseRecipeLabel stores, or null for a key or market without a label.
function seedRecipeLabel(market, recipeKey) {
  const recipe = RECIPE_LABELS[recipeKey];
  const shared = SHARED[market];
  if (!recipe || !shared) {
    return null;
  }
  const local = recipe[market];
  return {
    productName: `${shared.productPrefix}${local.name}`,
    netWeight: shared.netWeight,
    freshnessNote: shared.freshnessNote,
    energyKg: `${formatEnergy(recipe.energyKg, market)} kcal/kg`,
    energyPackage: `${recipe.energyPackage} kcal ${market === 'BR' ? 'por embalagem' : 'per package'}`,
    manufacturer: 'Pawl & Bowl LLC',
    manufacturerLocation: 'Boca Raton, FL 33487\nUSA',
    ingredients: local.ingredients.map((item) => (item === '{supplement}' ? shared.supplement : item)),
    notices: [...shared.notices],
    storage: [...shared.storage],
    feeding: [...shared.feeding],
    analysis: ANALYSIS_NUTRIENTS[market].map((nutrient, index) => ({ nutrient, value: formatPercent(recipe.analysis[index], market) }))
  };
}

// Recipes every market starts with: { market, key, name }.
function seedRecipeRegistrations() {
  return Object.keys(SHARED).flatMap((market) => Object.entries(RECIPE_LABELS)
    .map(([key, recipe]) => ({ market, key, name: recipe[market].title })));
}

module.exports = {
  RECIPE_LABELS,
  seedRecipeRegistrations,
  seedRecipeLabel
};
