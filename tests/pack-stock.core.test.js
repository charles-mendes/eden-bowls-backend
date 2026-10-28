const { allocateCoverage, buildOverview } = require('../src/core/pack-stock');

function cycle(subscriptionId, lineItems, overrides = {}) {
  return {
    key: `${subscriptionId}|2026-10-20T08:00:00.000Z`,
    subscriptionId,
    periodEnd: '2026-10-20T08:00:00.000Z',
    dueAt: '2026-10-20T08:00:00.000Z',
    productionStatus: 'to_prepare',
    paymentState: 'paid',
    lineItems,
    ...overrides
  };
}

function line(flavorKey, quantity, packSizeGrams = 300) {
  return { flavorKey, flavor: flavorKey, quantity, packSizeGrams };
}

function itemOf(overview, flavorKey, packSizeGrams = 300) {
  return overview.items.find((item) => item.flavorKey === flavorKey && item.packSizeGrams === packSizeGrams);
}

describe('pack stock core', () => {
  test('Kitchen plans the week', () => {
    const overview = buildOverview({
      stockItems: [{ flavorKey: 'frango', packSizeGrams: 300, onHand: 40, minLevel: null }],
      cycles: [
        cycle(1, [line('frango', 30)]),
        cycle(2, [line('frango', 15)], { productionStatus: 'in_production' }),
        cycle(3, [line('frango', 10)], { paymentState: 'awaiting_payment' })
      ]
    });

    expect(itemOf(overview, 'frango')).toMatchObject({
      onHand: 40,
      committed: 55,
      committedAwaitingPayment: 10,
      available: -15,
      toProduce: 15
    });
  });

  test('Blocked and ready cycles are left out', () => {
    const overview = buildOverview({
      cycles: [
        cycle(1, [line('frango', 3)]),
        cycle(2, [line('frango', 5)], { productionStatus: 'blocked' }),
        cycle(3, [line('frango', 4)], { productionStatus: 'ready' })
      ]
    });

    expect(itemOf(overview, 'frango').committed).toBe(3);
  });

  test('New recipe with demand only', () => {
    const overview = buildOverview({ stockItems: [], cycles: [cycle(1, [line('salmon', 6, 454)])] });

    expect(itemOf(overview, 'salmon', 454)).toMatchObject({ onHand: 0, committed: 6, toProduce: 6, minLevel: null });
  });

  test('Below minimum after commitments', () => {
    const overview = buildOverview({
      stockItems: [{ flavorKey: 'carne', packSizeGrams: 500, onHand: 20, minLevel: 10 }],
      cycles: [cycle(1, [line('carne', 15, 500)])]
    });

    expect(itemOf(overview, 'carne', 500)).toMatchObject({ available: 5, toProduce: 0, belowMinimum: true });
  });

  test('pets of the same recipe and size add up', () => {
    const overview = buildOverview({
      cycles: [cycle(1, [{ ...line('frango', 2), petName: 'Luna' }, { ...line('frango', 3), petName: 'Thor' }])]
    });

    expect(itemOf(overview, 'frango').committed).toBe(5);
  });

  test('Earlier delivery takes the stock first', () => {
    const stockItems = [{ flavorKey: 'frango', packSizeGrams: 300, onHand: 5 }];
    const later = cycle(1, [line('frango', 4)], { key: 'later', dueAt: '2026-10-23T15:00:00.000Z' });
    const sooner = cycle(2, [line('frango', 4)], { key: 'sooner', dueAt: '2026-10-21T15:00:00.000Z' });

    const coverage = allocateCoverage({ stockItems, cycles: [later, sooner] });

    expect(coverage.get('sooner')).toBe('covered');
    expect(coverage.get('later')).toBe('short');
  });

  test('negative on-hand leaves every cycle short, and non-committing cycles get no coverage', () => {
    const coverage = allocateCoverage({
      stockItems: [{ flavorKey: 'frango', packSizeGrams: 300, onHand: -2 }],
      cycles: [cycle(1, [line('frango', 1)], { key: 'a' }), cycle(2, [line('frango', 1)], { key: 'b', productionStatus: 'ready' })]
    });

    expect(coverage.get('a')).toBe('short');
    expect(coverage.has('b')).toBe(false);
  });

  test('Line without pack size', () => {
    const coverage = allocateCoverage({
      stockItems: [{ flavorKey: 'frango', packSizeGrams: 300, onHand: 50 }],
      cycles: [cycle(1, [line('frango', 1), { flavorKey: 'frango', flavor: 'Frango', quantity: 3, packSizeGrams: null }], { key: 'a' })]
    });

    expect(coverage.get('a')).toBe('unknown');
  });

  test('Overview reports a line without size', () => {
    const overview = buildOverview({
      cycles: [cycle(42, [{ flavorKey: 'frango', flavor: 'Frango', quantity: 3, packSizeGrams: null }])]
    });

    expect(overview.items).toEqual([]);
    expect(overview.unsizedLines).toEqual([
      { subscriptionId: 42, periodEnd: '2026-10-20T08:00:00.000Z', flavorKey: 'frango', label: 'Frango', quantity: 3 }
    ]);
  });

  test('Nothing unsized', () => {
    const overview = buildOverview({ cycles: [cycle(1, [line('frango', 2)])] });

    expect(overview.unsizedLines).toEqual([]);
  });
});
