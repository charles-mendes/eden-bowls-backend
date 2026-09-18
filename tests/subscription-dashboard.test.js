const { mapLedgerToDashboardDetail } = require('../src/core/subscription-dashboard');

function ledgerRow(account, selectedFlavors) {
  return {
    stripeSubscriptionId: 'sub_flavor_1',
    status: 'active',
    stripeAccount: account,
    planSelection: {
      pets: [{ pet_name: 'Luna', selected_flavors: selectedFlavors }],
      catalog_pricing: {
        currency: account === 'br' ? 'BRL' : 'USD',
        line_items: selectedFlavors.map((flavor) => ({
          pet_name: 'Luna',
          flavor,
          quantity: 2,
          unit_price: 22.5,
          line_total: 45
        }))
      }
    }
  };
}

const BR_CATALOG = [
  { key: 'beef', label: 'Bovino', aliases: ['bovino', 'carne'] },
  { key: 'turkey', label: 'Frango', aliases: ['chicken', 'frango', 'peru'] }
];

const US_CATALOG = [
  { key: 'turkey', label: 'Chicken', aliases: ['chicken', 'frango', 'peru'] }
];

describe('subscription dashboard flavor labels', () => {
  test('canonicalizes chicken aliases to turkey and labels Brazil from the catalog', () => {
    const detail = mapLedgerToDashboardDetail(
      ledgerRow('br', ['chicken', 'frango', 'turkey']),
      { catalogFlavorOptions: BR_CATALOG }
    );

    expect(detail.active_flavors).toEqual(['turkey']);
    expect(detail.active_flavor_options).toEqual([{ key: 'turkey', label: 'Frango' }]);
    expect(detail.plan_items[0]).toMatchObject({
      flavor: 'turkey',
      label: 'Luna — Frango'
    });
  });

  test('labels United States turkey as the catalog Chicken label', () => {
    const detail = mapLedgerToDashboardDetail(
      ledgerRow('us', ['chicken']),
      { catalogFlavorOptions: US_CATALOG }
    );

    expect(detail.active_flavors).toEqual(['turkey']);
    expect(detail.active_flavor_options).toEqual([{ key: 'turkey', label: 'Chicken' }]);
    expect(detail.plan_items[0]).toMatchObject({
      flavor: 'turkey',
      label: 'Luna — Chicken'
    });
  });

  test('does not invent a market label when the catalog is missing', () => {
    const detail = mapLedgerToDashboardDetail(ledgerRow('br', ['turkey']));

    expect(detail.active_flavor_options).toEqual([{ key: 'turkey', label: 'turkey' }]);
    expect(detail.plan_items[0].label).toBe('Luna — turkey');
  });
});
