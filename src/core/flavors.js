const FLAVOR_KEYS = ['beef', 'fish', 'pork', 'turkey'];

const FLAVOR_CATALOG = {
  BR: {
    country: 'BR',
    currency: 'BRL',
    zoneId: 'br',
    product: {
      id: 100,
      title: 'Flavors BR',
      slug: 'flavors-br',
      days: 30,
      menuOrder: 1
    },
    packs: [
      {
        weight: '300g',
        prices: {
          beef: 25,
          fish: 35,
          pork: 25,
          turkey: 22.5
        }
      },
      {
        weight: '500g',
        prices: {
          beef: 45,
          fish: 65,
          pork: 45,
          turkey: 42.5
        }
      }
    ]
  },
  US: {
    country: 'US',
    currency: 'USD',
    zoneId: 'us',
    product: {
      id: 200,
      title: 'Flavors US',
      slug: 'flavors-us',
      days: 30,
      menuOrder: 2
    },
    packs: [
      {
        weight: '10.6oz',
        prices: {
          beef: 25,
          fish: 35,
          pork: 25,
          turkey: 22.5
        }
      },
      {
        weight: '17.6oz',
        prices: {
          beef: 45,
          fish: 65,
          pork: 45,
          turkey: 42.5
        }
      }
    ]
  }
};

function listFlavorOptions(market) {
  const labels = market && market.flavorLabels ? market.flavorLabels : {};

  return FLAVOR_KEYS.map((key) => ({
    key,
    label: labels[key] || key
  }));
}

function listFlavorVariations(country) {
  const catalog = FLAVOR_CATALOG[country];

  if (!catalog) {
    return [];
  }

  return catalog.packs.flatMap((pack) => (
    FLAVOR_KEYS.map((flavor) => ({
      flavor,
      weight: pack.weight,
      price: pack.prices[flavor],
      currency: catalog.currency,
      zoneId: catalog.zoneId
    }))
  ));
}

module.exports = {
  FLAVOR_KEYS,
  FLAVOR_CATALOG,
  listFlavorOptions,
  listFlavorVariations
};
