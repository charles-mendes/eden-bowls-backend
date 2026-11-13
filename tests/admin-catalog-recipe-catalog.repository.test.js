const { AdminCatalogRepository } = require('../src/infrastructure/repositories/admin-catalog.repository');

function row(fields) {
  return { market: 'BR', shortLabel: '', label: '', sku: '', published: false, ...fields };
}

describe('AdminCatalogRepository.listRecipeCatalog', () => {
  it('lists one entry per product and size of the market, named after the product', async () => {
    const repository = Object.create(AdminCatalogRepository.prototype);
    repository.recipeVariationRows = jest.fn().mockResolvedValue([
      row({ key: 'beef', packSizeGrams: 500, productId: '10', productName: 'Bovino', variationId: '101', sku: 'B500', shortLabel: 'Bovino 500g', published: true }),
      row({ key: 'beef', packSizeGrams: 300, productId: '10', productName: 'Bovino', variationId: '102', sku: '' }),
      row({ key: 'senior-beef', packSizeGrams: 300, productId: '11', productName: 'Bovino Senior', variationId: '111', sku: 'S300' }),
      row({ key: 'fish', packSizeGrams: null, productId: '12', productName: 'Peixe', variationId: '121' }),
      row({ market: 'US', key: 'pork', packSizeGrams: 300, productId: '20', productName: 'Pork', variationId: '201' })
    ]);

    await expect(repository.listRecipeCatalog('br')).resolves.toEqual([
      { flavorKey: 'beef', packSizeGrams: 300, label: 'Bovino', productId: '10', variationId: '102', sku: null, published: false },
      { flavorKey: 'beef', packSizeGrams: 500, label: 'Bovino', productId: '10', variationId: '101', sku: 'B500', published: true },
      { flavorKey: 'senior-beef', packSizeGrams: 300, label: 'Bovino Senior', productId: '11', variationId: '111', sku: 'S300', published: false }
    ]);
  });

  it('names a repeated size after its published variation', async () => {
    const repository = Object.create(AdminCatalogRepository.prototype);
    repository.recipeVariationRows = jest.fn().mockResolvedValue([
      row({ key: 'beef', packSizeGrams: 500, productId: '10', productName: 'Rascunho', variationId: '101' }),
      row({ key: 'beef', packSizeGrams: 500, productId: '11', productName: 'Bovino', variationId: '102', published: true })
    ]);

    await expect(repository.listRecipeCatalog('BR')).resolves.toEqual([
      { flavorKey: 'beef', packSizeGrams: 500, label: 'Bovino', productId: '11', variationId: '102', sku: null, published: true }
    ]);
  });
});

describe('AdminCatalogRepository.listVariationsWithoutWeight', () => {
  it('lists the variations on sale in the market that have no weight', async () => {
    const repository = Object.create(AdminCatalogRepository.prototype);
    repository.recipeVariationRows = jest.fn().mockResolvedValue([
      row({ key: 'senior-beef', packSizeGrams: null, productId: '2038', productName: 'Bovino', lifeStage: 'senior', variationId: '2015', name: 'Bovino para Senior', sku: '1005', published: true }),
      row({ key: 'puppy-chicken-pork', packSizeGrams: null, productId: '2035', productName: 'Frango e Porco', lifeStage: 'puppy', variationId: '2013', sku: '1003', published: true }),
      row({ key: 'beef', packSizeGrams: null, productId: '2025', productName: 'Bovino', variationId: '2011', published: false }),
      row({ key: 'beef', packSizeGrams: 300, productId: '2025', productName: 'Bovino', variationId: '1001', published: true }),
      row({ market: 'US', key: 'pork', packSizeGrams: null, productId: '20', productName: 'Pork', variationId: '201', published: true })
    ]);

    await expect(repository.listVariationsWithoutWeight('br')).resolves.toEqual([
      { productId: '2038', productName: 'Bovino', lifeStage: 'senior', variationId: '2015', name: 'Bovino para Senior', sku: '1005' },
      { productId: '2035', productName: 'Frango e Porco', lifeStage: 'puppy', variationId: '2013', name: null, sku: '1003' }
    ]);
  });
});
