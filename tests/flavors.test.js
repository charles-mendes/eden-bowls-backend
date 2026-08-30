const { FLAVOR_KEYS, flavorOptionsFromLabels, listFlavorOptions, listFlavorVariations } = require('../src/core/flavors');
const { MARKETS } = require('../src/core/market');

describe('flavor catalog', () => {
  test('exposes the current app flavors in catalog order', () => {
    expect(FLAVOR_KEYS).toEqual(['beef', 'fish', 'pork', 'turkey']);
  });

  test('builds flavor options from catalog labels and localizes known keys', () => {
    expect(flavorOptionsFromLabels(['Beef', 'Lamb', 'beef', ''], MARKETS.BR)).toEqual([
      { key: 'beef', label: 'Bovino' },
      { key: 'lamb', label: 'Lamb' }
    ]);
  });

  test('lists localized flavor options for Brazil and the United States', () => {
    expect(listFlavorOptions(MARKETS.BR)).toEqual([
      { key: 'beef', label: 'Bovino' },
      { key: 'fish', label: 'Peixe' },
      { key: 'pork', label: 'Porco' },
      { key: 'turkey', label: 'Peru' }
    ]);

    expect(listFlavorOptions(MARKETS.US)).toEqual([
      { key: 'beef', label: 'Beef' },
      { key: 'fish', label: 'Fish' },
      { key: 'pork', label: 'Pork' },
      { key: 'turkey', label: 'Turkey' }
    ]);
  });

  test('lists Brazil pack prices for 300g and 500g', () => {
    expect(listFlavorVariations('BR')).toEqual([
      { flavor: 'beef', weight: '300g', price: 25, currency: 'BRL', zoneId: 'br' },
      { flavor: 'fish', weight: '300g', price: 35, currency: 'BRL', zoneId: 'br' },
      { flavor: 'pork', weight: '300g', price: 25, currency: 'BRL', zoneId: 'br' },
      { flavor: 'turkey', weight: '300g', price: 22.5, currency: 'BRL', zoneId: 'br' },
      { flavor: 'beef', weight: '500g', price: 45, currency: 'BRL', zoneId: 'br' },
      { flavor: 'fish', weight: '500g', price: 65, currency: 'BRL', zoneId: 'br' },
      { flavor: 'pork', weight: '500g', price: 45, currency: 'BRL', zoneId: 'br' },
      { flavor: 'turkey', weight: '500g', price: 42.5, currency: 'BRL', zoneId: 'br' }
    ]);
  });

  test('lists United States pack prices for 10.6oz and 17.6oz', () => {
    expect(listFlavorVariations('US')).toEqual([
      { flavor: 'beef', weight: '10.6oz', price: 25, currency: 'USD', zoneId: 'us' },
      { flavor: 'fish', weight: '10.6oz', price: 35, currency: 'USD', zoneId: 'us' },
      { flavor: 'pork', weight: '10.6oz', price: 25, currency: 'USD', zoneId: 'us' },
      { flavor: 'turkey', weight: '10.6oz', price: 22.5, currency: 'USD', zoneId: 'us' },
      { flavor: 'beef', weight: '17.6oz', price: 45, currency: 'USD', zoneId: 'us' },
      { flavor: 'fish', weight: '17.6oz', price: 65, currency: 'USD', zoneId: 'us' },
      { flavor: 'pork', weight: '17.6oz', price: 45, currency: 'USD', zoneId: 'us' },
      { flavor: 'turkey', weight: '17.6oz', price: 42.5, currency: 'USD', zoneId: 'us' }
    ]);
  });
});
