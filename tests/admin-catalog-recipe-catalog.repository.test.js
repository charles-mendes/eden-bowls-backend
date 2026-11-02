const { AdminCatalogRepository } = require('../src/infrastructure/repositories/admin-catalog.repository');

describe('AdminCatalogRepository.listRecipeCatalog', () => {
  it('lists one named entry per recipe and size of the market', async () => {
    const repository = Object.create(AdminCatalogRepository.prototype);
    repository.recipeVariationRows = jest.fn().mockResolvedValue([
      { market: 'BR', key: 'beef', packSizeGrams: 500, shortLabel: 'Carne', label: 'Bovino' },
      { market: 'BR', key: 'beef', packSizeGrams: 500, shortLabel: 'Outro', label: 'Outro' },
      { market: 'BR', key: 'beef', packSizeGrams: 300, shortLabel: '', label: 'Bovino' },
      { market: 'BR', key: 'fish', packSizeGrams: null, shortLabel: 'Peixe', label: 'Peixe' },
      { market: 'US', key: 'pork', packSizeGrams: 300, shortLabel: 'Pork', label: 'Pork' }
    ]);

    await expect(repository.listRecipeCatalog('br')).resolves.toEqual([
      { flavorKey: 'beef', packSizeGrams: 300, label: 'Bovino' },
      { flavorKey: 'beef', packSizeGrams: 500, label: 'Carne' }
    ]);
  });
});
