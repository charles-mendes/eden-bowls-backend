const { ownedPets, petSubscriptions } = require('../src/core/subscription-pet-link');

function row(extra = {}) {
  return {
    id: 1,
    status: 'active',
    createdAt: '2026-10-01 10:00:00',
    planSelection: { pets: [{ pet_id: 'rex', pet_name: 'Rex', enabled: true }] },
    petsSnapshot: { pet_ids: ['rex'], pets_names: ['Rex'], pets: [{ id: 'rex', name: 'Rex' }] },
    ...extra
  };
}

describe('ownedPets: statuses', () => {
  test.each(['active', 'trialing', 'past_due', 'paused', 'incomplete'])('%s owns the pet', (status) => {
    expect(ownedPets(row({ status }))).toEqual([{ id: 'rex', name: 'Rex' }]);
  });

  test.each(['canceled', 'incomplete_expired', ''])('"%s" owns no pet', (status) => {
    expect(ownedPets(row({ status }))).toEqual([]);
  });
});

describe('ownedPets: disabled pets and the snapshot fallback', () => {
  test('a disabled pet still in the snapshot is not owned', () => {
    const planSelection = { pets: [{ pet_id: 'rex', enabled: false }, { pet_id: 'luna', pet_name: 'Luna', enabled: true }] };
    expect(ownedPets(row({ planSelection }))).toEqual([{ id: 'luna', name: 'Luna' }]);
  });

  test('a disabled pet that still has a priced line is not owned', () => {
    const planSelection = {
      pets: [{ pet_id: 'rex', enabled: false }],
      catalog_pricing: { line_items: [{ pet_id: 'rex' }] }
    };
    expect(ownedPets(row({ planSelection }))).toEqual([]);
  });

  test('a plan whose pets are all disabled does not fall back to the snapshot', () => {
    const planSelection = { pets: [{ pet_id: 'rex', enabled: false }] };
    expect(ownedPets(row({ planSelection }))).toEqual([]);
  });

  test('an old subscription without plan pets falls back to the snapshot', () => {
    expect(ownedPets(row({ planSelection: null }))).toEqual([{ id: 'rex', name: 'Rex' }]);
    expect(ownedPets(row({ planSelection: { pets: [] } }))).toEqual([{ id: 'rex', name: 'Rex' }]);
  });

  test('a priced line pet without a plan pet entry is owned', () => {
    const planSelection = { pets: [], catalog_pricing: { line_items: [{ pet_id: 'rex' }] } };
    expect(ownedPets(row({ planSelection }))).toEqual([{ id: 'rex', name: 'Rex' }]);
  });
});

describe('ownedPets: names', () => {
  test('the plan name wins over the snapshot name', () => {
    const planSelection = { pets: [{ pet_id: 'rex', pet_name: 'Rexinho' }] };
    expect(ownedPets(row({ planSelection }))).toEqual([{ id: 'rex', name: 'Rexinho' }]);
  });

  test('falls back to the snapshot name, then to an empty name', () => {
    const planSelection = { pets: [{ pet_id: 'rex' }, { pet_id: 'luna' }] };
    expect(ownedPets(row({ planSelection }))).toEqual([{ id: 'rex', name: 'Rex' }, { id: 'luna', name: '' }]);
  });
});

describe('petSubscriptions', () => {
  test('lists the owning subscriptions newest first, ties broken by id', () => {
    const rows = [
      row({ id: 1, status: 'paused', createdAt: '2026-10-01 10:00:00' }),
      row({ id: 2, status: 'active', createdAt: '2026-11-01 10:00:00' }),
      row({ id: 3, status: 'trialing', createdAt: '2026-11-01 10:00:00' }),
      row({ id: 4, status: 'canceled', createdAt: '2026-12-01 10:00:00' })
    ];
    expect(petSubscriptions('rex', rows).map((item) => item.id)).toEqual([3, 2, 1]);
  });

  test('a pet on no owning subscription gets none', () => {
    expect(petSubscriptions('luna', [row()])).toEqual([]);
    expect(petSubscriptions('rex', [row({ status: 'canceled' })])).toEqual([]);
    expect(petSubscriptions('', [row()])).toEqual([]);
  });
});
