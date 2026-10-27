const request = require('supertest');
const { createApp } = require('../src/app');
const { RecipeContentService } = require('../src/services/recipe-content.service');

function appFor({ variations = {}, contents = {} } = {}) {
  const recipeContentService = new RecipeContentService({
    repository: {
      findByMarketAndSlug: jest.fn(async (market, key) => contents[`${market}:${key}`] || null)
    },
    catalogRepository: {
      listRecipeVariations: jest.fn(async (market, key) => variations[`${market}:${key}`] || [])
    }
  });
  return createApp({ corsOrigins: ['http://localhost:5173'], recipeContentService });
}

describe('GET /api/v1/recipes/:key', () => {
  test('resolves the store key chicken to turkey and returns its stored image without auth', async () => {
    const app = appFor({
      variations: { 'US:turkey': [{ id: '11', name: 'Chicken 300g', sku: 'C', active: true }] },
      contents: { 'US:turkey': { imageUrl: '/recipe-images/recipe-us-turkey-1.webp', label: null } }
    });

    const response = await request(app).get('/api/v1/recipes/chicken?market=US');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ key: 'turkey', market: 'US', imageUrl: '/recipe-images/recipe-us-turkey-1.webp', planImageUrl: null, label: null });
  });

  test('returns null content for a launched recipe with nothing stored', async () => {
    const app = appFor({ variations: { 'BR:pork': [{ id: '21', name: 'Porco 300g', sku: 'P', active: true }] } });

    const response = await request(app).get('/api/v1/recipes/pork?market=br');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ key: 'pork', market: 'BR', imageUrl: null, planImageUrl: null, label: null });
  });

  test('returns the stored label whole', async () => {
    const label = {
      productName: 'Fresh Frozen Dog Food – Beef Recipe',
      ingredients: ['Potatoes', 'Beef'],
      analysis: [{ nutrient: 'Crude Protein (min)', value: '9.0%' }],
      energyKg: '1,200 kcal/kg',
      energyPackage: '360 kcal per package',
      notices: ['This product is intended for intermittent or supplemental feeding only.']
    };
    const app = appFor({
      variations: { 'US:beef': [{ id: '14', name: 'Beef 300g', sku: 'B', active: true }] },
      contents: { 'US:beef': { imageUrl: null, label } }
    });

    const response = await request(app).get('/api/v1/recipes/beef?market=US');

    expect(response.body).toEqual({ key: 'beef', market: 'US', imageUrl: null, planImageUrl: null, label });
  });

  test('hides a recipe with no active variation in the market', async () => {
    const app = appFor({
      variations: { 'BR:senior-beef': [{ id: '301', name: 'Sênior Carne 300g', sku: 'S', active: false }] },
      contents: { 'BR:senior-beef': { imageUrl: '/recipe-images/recipe-br-senior-beef-1.webp', label: null } }
    });

    const response = await request(app).get('/api/v1/recipes/senior-beef?market=BR');

    expect(response.status).toBe(404);
    expect(response.body.imageUrl).toBeUndefined();
  });

  test('hides a registered recipe that no variation uses', async () => {
    const app = appFor({ contents: { 'BR:senior-lamb': { imageUrl: '/recipe-images/lamb.webp', label: null } } });

    const response = await request(app).get('/api/v1/recipes/senior-lamb?market=BR');

    expect(response.status).toBe(404);
  });

  test('refuses an unknown market', async () => {
    const response = await request(appFor()).get('/api/v1/recipes/beef?market=AR');
    expect(response.status).toBe(400);
  });
});

describe('GET /api/v1/recipes', () => {
  // Registered recipes per market and the variations of each key, as the market listing reads them.
  function listingApp({ recipes = [], variations = {} } = {}) {
    const recipeContentService = new RecipeContentService({
      repository: {
        listByMarket: jest.fn(async (market) => recipes.filter((recipe) => recipe.market === market))
      },
      catalogRepository: {
        listMarketRecipeVariations: jest.fn(async (market) => new Map(
          Object.entries(variations)
            .filter(([marketKey]) => marketKey.startsWith(`${market}:`))
            .map(([marketKey, list]) => [marketKey.slice(market.length + 1), list])
        ))
      }
    });
    return createApp({ corsOrigins: ['http://localhost:5173'], recipeContentService });
  }

  const recipes = [
    { market: 'BR', flavorSlug: 'beef', name: 'Bovino', lifeStage: 'adult', imageUrl: '/recipe-images/beef.webp', label: { productName: 'X' } },
    { market: 'BR', flavorSlug: 'senior-beef', name: 'Receita de Carne para Cães Sênior', lifeStage: 'senior', imageUrl: null, label: null },
    { market: 'BR', flavorSlug: 'puppy-beef-chicken', name: 'Filhote', lifeStage: 'puppy', imageUrl: null, label: null }
  ];

  test('lists the launched recipes of the market without auth, label or images', async () => {
    const app = listingApp({
      recipes,
      variations: {
        'BR:beef': [{ id: '1', active: true }],
        'BR:senior-beef': [{ id: '2', active: false }, { id: '3', active: true }],
        'BR:puppy-beef-chicken': [{ id: '4', active: false }]
      }
    });

    const response = await request(app).get('/api/v1/recipes?market=br');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      market: 'BR',
      items: [
        { key: 'beef', name: 'Bovino', lifeStage: 'adult' },
        { key: 'senior-beef', name: 'Receita de Carne para Cães Sênior', lifeStage: 'senior' }
      ]
    });
  });

  test('refuses an unknown market', async () => {
    const response = await request(listingApp()).get('/api/v1/recipes?market=AR');

    expect(response.status).toBe(400);
    expect(response.body.details).toMatchObject({ code: 'invalid_market' });
  });

  test('refuses a missing market', async () => {
    const response = await request(listingApp()).get('/api/v1/recipes');

    expect(response.status).toBe(400);
  });
});
