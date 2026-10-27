// Recipe page presentation the store showed before the admin edited it (eden-bowls src/content/{pt-br,en-us}/recipes/*.md
// and the colors of src/data/recipes.ts). Keys are recipe_contents.flavor_slug: the store key `chicken` is `turkey` here.

// The five colors of the recipe page, the same in both markets.
const RECIPE_COLORS = {
  beef: { color: '#C97B6C', accentColor: '#EAB8A8', pillBg: '#E8CCBC', pillText: '#5A2010', pillBorder: '#C0907C' },
  turkey: { color: '#B08F66', accentColor: '#D0A860', pillBg: '#E4D0A8', pillText: '#3C2800', pillBorder: '#B09060' },
  fish: { color: '#7898BE', accentColor: '#88B4D4', pillBg: '#C8DCF0', pillText: '#102038', pillBorder: '#7898B8' },
  pork: { color: '#C4898A', accentColor: '#E8AAAA', pillBg: '#E8C8C8', pillText: '#501820', pillBorder: '#C09090' },
  'puppy-beef-chicken': { color: '#D37D9B', accentColor: '#D37D9B', pillBg: '#E8BACA', pillText: '#451123', pillBorder: '#BA788F' },
  'puppy-chicken-pork': { color: '#D0A65A', accentColor: '#D0A65A', pillBg: '#E8D8BA', pillText: '#453311', pillBorder: '#BAA278' },
  'senior-beef': { color: '#A784C5', accentColor: '#A784C5', pillBg: '#D3BAE8', pillText: '#2D1145', pillBorder: '#9C78BA' },
  'senior-chicken': { color: '#6AA98C', accentColor: '#6AA98C', pillBg: '#BAE8D3', pillText: '#11452D', pillBorder: '#78BA9C' }
};

// Title, tagline, resume and highlights per market, in the market language.
const RECIPE_TEXTS = {
  BR: {
    beef: {
      title: 'Receita de Carne',
      tagline: 'Força & Vitalidade',
      resume: 'Rica em proteína e ferro, nossa receita de carne bovina apoia músculos fortes e energia duradoura.',
      highlights: ['Batatas', 'Carne bovina', 'Arroz branco', 'Cenoura', 'Espinafre']
    },
    turkey: {
      title: 'Receita de Frango',
      tagline: 'Leve & Magro',
      resume: 'Uma opção leve e saborosa, cheia de bondade natural que o seu cão vai adorar.',
      highlights: ['Mandioca', 'Frango', 'Abóbora Cabotiá', 'Vagem', 'Brócolis']
    },
    fish: {
      title: 'Receita de Peixe',
      tagline: 'Pelo & Brilho',
      resume: 'Rico em ômega-3 e leve, nossa receita de peixe apoia uma pelagem saudável, articulações e a função cerebral.',
      highlights: ['Batata-doce', 'Tilápia', 'Cenoura', 'Abobrinha', 'Couve-flor']
    },
    pork: {
      title: 'Receita de Porco',
      tagline: 'Equilíbrio & Variedade',
      resume: 'Macio e nutritivo, nossa receita de porco traz variedade e equilíbrio para cada bowl.',
      highlights: ['Batata-doce', 'Carne suína', 'Lentilha', 'Ervilha', 'Couve']
    },
    'puppy-beef-chicken': {
      title: 'Receita de Carne e Frango para Filhotes',
      tagline: 'Primeiros Anos',
      resume: 'Da nossa linha para filhotes, com carne bovina, frango, arroz integral e lentilha. Mais energia por porção para quem gasta energia o dia inteiro.',
      highlights: ['Carne bovina', 'Frango', 'Arroz integral', 'Lentilha', 'Abobrinha']
    },
    'puppy-chicken-pork': {
      title: 'Receita de Frango e Porco para Filhotes',
      tagline: 'Crescimento & Energia',
      resume: 'Da nossa linha para filhotes, com frango, porco, arroz integral e legumes cozidos. Tem mais energia por porção que as receitas de adulto, para acompanhar o ritmo de quem não para.',
      highlights: ['Frango', 'Arroz integral', 'Abóbora cabotiá', 'Porco', 'Abobrinha']
    },
    'senior-beef': {
      title: 'Receita de Carne para Cães Sênior',
      tagline: 'Leveza & Equilíbrio',
      resume: 'Da nossa linha sênior, com carne bovina, ovo, batata e vagem. Um pouco mais leve em calorias que as receitas de adulto, para a fase mais tranquila da vida.',
      highlights: ['Carne bovina', 'Batata', 'Vagem', 'Arroz branco', 'Ovo']
    },
    'senior-chicken': {
      title: 'Receita de Frango para Cães Sênior',
      tagline: 'Cuidado na Maturidade',
      resume: 'Da nossa linha sênior, com sobrecoxa de frango sem pele, batata-doce e legumes. Macia e um pouco mais leve em calorias que as receitas de adulto.',
      highlights: ['Frango', 'Batata-doce', 'Arroz branco', 'Cenoura', 'Abobrinha']
    }
  },
  US: {
    beef: {
      title: 'Beef Recipe',
      tagline: 'Strength & Vitality',
      resume: 'Rich in protein and iron, our beef recipe supports strong muscles and lasting energy.',
      highlights: ['Potatoes', 'Beef', 'White Rice', 'Carrots', 'Spinach']
    },
    turkey: {
      title: 'Chicken Recipe',
      tagline: 'Light & Lean',
      resume: 'A lean and flavorful option, packed with natural goodness your dog will love.',
      highlights: ['Cassava', 'Chicken', 'Kabocha Squash', 'Green Beans', 'Broccoli']
    },
    fish: {
      title: 'Fish Recipe',
      tagline: 'Coat & Brilliance',
      resume: 'Rich in omega-3s and light, our fish recipe supports a healthy coat, joints, and brain function.',
      highlights: ['Sweet Potatoes', 'Tilapia', 'Carrots', 'Zucchini', 'Cauliflower']
    },
    pork: {
      title: 'Pork Recipe',
      tagline: 'Balance & Variety',
      resume: 'Tender and nutritious, our pork recipe brings variety and balance to every bowl.',
      highlights: ['Sweet Potatoes', 'Pork', 'Lentils', 'Green Peas', 'Collard Greens']
    },
    'puppy-beef-chicken': {
      title: 'Beef & Chicken Recipe for Puppies',
      tagline: 'Early Years',
      resume: 'From our puppy line, with beef, chicken, brown rice and lentils. More energy per serving for pups who burn energy all day long.',
      highlights: ['Beef', 'Chicken', 'Brown Rice', 'Lentils', 'Zucchini']
    },
    'puppy-chicken-pork': {
      title: 'Chicken & Pork Recipe for Puppies',
      tagline: 'Growth & Energy',
      resume: 'From our puppy line, with chicken, pork, brown rice and cooked vegetables. More energy per serving than our adult recipes, to keep up with pups who never stop.',
      highlights: ['Chicken', 'Brown Rice', 'Kabocha Squash', 'Pork', 'Zucchini']
    },
    'senior-beef': {
      title: 'Beef Recipe for Senior Dogs',
      tagline: 'Lightness & Balance',
      resume: 'From our senior line, with beef, egg, potatoes and green beans. Slightly lower in calories than our adult recipes, for the calmer stage of life.',
      highlights: ['Beef', 'Potatoes', 'Green Beans', 'White Rice', 'Egg']
    },
    'senior-chicken': {
      title: 'Chicken Recipe for Senior Dogs',
      tagline: 'Care in Maturity',
      resume: 'From our senior line, with skinless chicken thigh, sweet potatoes and vegetables. Tender and slightly lower in calories than our adult recipes.',
      highlights: ['Chicken', 'Sweet Potatoes', 'White Rice', 'Carrots', 'Zucchini']
    }
  }
};

// Presentation in the shape parseRecipePresentation stores, or null for a key or market without one.
function seedRecipePresentation(market, recipeKey) {
  const text = (RECIPE_TEXTS[market] || {})[recipeKey];
  if (!text) {
    return null;
  }
  return { ...text, highlights: [...text.highlights], colors: { ...RECIPE_COLORS[recipeKey] } };
}

module.exports = {
  RECIPE_TEXTS,
  seedRecipePresentation
};
