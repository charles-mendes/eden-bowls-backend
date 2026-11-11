const { presentProductionQueueItem } = require('../src/core/production-queue-presenter');

function baseRow(overrides = {}) {
  return {
    id: 42,
    userId: 7,
    customerEmail: 'ana@edenbowls.com',
    displayName: 'Ana Costa',
    stripeSubscriptionId: 'sub_123',
    stripeAccount: 'br',
    status: 'active',
    planLabel: 'Plano adulto',
    currentPeriodEnd: '2026-09-20T08:00:00.000Z',
    cancelAtPeriodEnd: false,
    paymentMethodLast4: '4242',
    subscriptionTermMonths: 1,
    address: {
      name: 'Ana Costa',
      country: 'BR',
      city: 'São Paulo',
      street: 'Rua das Flores 100',
      postal_code: '01310-000'
    },
    planSelection: {
      catalog_pricing: {
        subtotal: 189.9,
        currency: 'BRL',
        line_items: [
          { flavor: 'beef', flavor_label: 'Bovino', quantity: 2, pack_size_label: '500 g', pet_name: 'Luna' },
          { flavor: 'turkey', flavor_label: 'Frango', quantity: 1, pack_size_label: '500 g', pet_name: 'Luna' }
        ]
      }
    },
    ...overrides
  };
}

describe('presentProductionQueueItem', () => {
  // simplify-brazil-dispatch: Expedir opens the courier queue on this invoice.
  test('names the paid invoice of a paid cycle and null for an unpaid one', () => {
    expect(presentProductionQueueItem(baseRow({ paymentState: 'paid', paidInvoiceId: 'in_123' })).paidInvoiceId).toBe('in_123');
    expect(presentProductionQueueItem(baseRow({ paymentState: 'awaiting_payment', paidInvoiceId: null })).paidInvoiceId).toBeNull();
    expect(presentProductionQueueItem(baseRow()).paidInvoiceId).toBeNull();
  });

  // keep-ready-orders-dispatchable: the courier lock shows on the queue row before anyone clicks Expedir.
  test('lists what the courier dispatch would refuse on a Brazil cycle, and null elsewhere', () => {
    const full = { country: 'BR', city: 'Curitiba', street: 'Rua A', number: '10', neighborhood: 'Centro', state: 'PR', postal_code: '80000-000', recipient_name: 'Ana Costa' };
    expect(presentProductionQueueItem(baseRow({ address: full })).courierIssues).toEqual([]);
    expect(presentProductionQueueItem(baseRow({ address: { ...full, recipient_name: '' } })).courierIssues).toEqual(['recipient_name_missing']);
    expect(presentProductionQueueItem(baseRow({ stripeAccount: 'us', address: { country: 'US', city: 'Miami' } })).courierIssues).toBeNull();
    expect(presentProductionQueueItem(baseRow({ stripeAccount: 'us', address: full })).courierIssues).toBeNull();
  });

  test('flattens catalog line items into mix, packs, and compact lineItems', () => {
    const item = presentProductionQueueItem(baseRow(), {
      timezone: 'America/Sao_Paulo',
      now: new Date('2026-09-20T15:00:00.000Z')
    });

    expect(item.flavorMix).toBe('Bovino × 2, Frango × 1');
    expect(item.packCount).toBe(3);
    expect(item.packSizeLabel).toBe('500 g');
    expect(item.subtotal).toBe(189.9);
    expect(item.dense).toBe(false);
    expect(item.lineItems).toEqual([
      { flavor: 'Bovino', flavorKey: 'beef', quantity: 2, packSize: '500 g', packSizeGrams: 500, petName: 'Luna' },
      { flavor: 'Frango', flavorKey: 'turkey', quantity: 1, packSize: '500 g', packSizeGrams: 500, petName: 'Luna' }
    ]);
  });

  test('gives each line its grams: stored, read from the label, or null', () => {
    const present = (lineItem) => presentProductionQueueItem(baseRow({
      planSelection: { catalog_pricing: { line_items: [{ flavor: 'frango', quantity: 3, ...lineItem }] } }
    }), { timezone: 'America/Sao_Paulo', now: new Date('2026-09-20T15:00:00.000Z') }).lineItems[0];

    expect(present({ pack_size_grams: 299.6, pack_size_label: '300 g' })).toMatchObject({ packSize: '300 g', packSizeGrams: 300 });
    expect(present({ pack_size_label: '300 g' })).toMatchObject({ packSize: '300 g', packSizeGrams: 300 });
    expect(present({ pack_size_label: '16.0 oz' }).packSizeGrams).toBe(454);
    expect(present({})).toMatchObject({ packSize: '', packSizeGrams: null });
  });

  test('shows the catalog short name first, then the full name, then the key', () => {
    const recipeNames = {
      BR: { 'senior-beef': { label: 'Receita de Carne para Cães Sênior', shortLabel: 'Bovino · Sênior' }, turkey: { label: 'Frango', shortLabel: '' } },
      US: { 'senior-chicken': { label: 'Chicken Recipe for Senior Dogs', shortLabel: '' } }
    };
    const br = presentProductionQueueItem(baseRow({
      planSelection: {
        catalog_pricing: {
          line_items: [
            { flavor: 'senior-beef', flavor_label: 'Receita de Carne para Cães Sênior', quantity: 4, pack_size_label: '300 g', pet_name: 'Thor' },
            { flavor: 'turkey', quantity: 1, pack_size_label: '300 g', pet_name: 'Thor' },
            { flavor: 'mystery', quantity: 1, pack_size_label: '300 g', pet_name: 'Thor' }
          ]
        }
      }
    }), { recipeNames });
    expect(br.flavorMix).toBe('Bovino · Sênior × 4, Frango × 1, mystery × 1');

    const us = presentProductionQueueItem(baseRow({
      stripeAccount: 'us',
      planSelection: {
        catalog_pricing: {
          line_items: [{ flavor: 'senior-chicken', flavor_label: 'Chicken Recipe for Senior Dogs', quantity: 2, pack_size_label: '10.6 oz', pet_name: 'Luna' }]
        }
      }
    }), { recipeNames });
    expect(us.flavorMix).toBe('Chicken Recipe for Senior Dogs × 2');
  });

  test('uses the market of the subscription to pick the short name', () => {
    const item = presentProductionQueueItem(baseRow({
      stripeAccount: 'us',
      planSelection: { catalog_pricing: { line_items: [{ flavor: 'senior-beef', flavor_label: 'Beef Recipe for Senior Dogs', quantity: 1 }] } }
    }), { recipeNames: { BR: { 'senior-beef': { label: 'x', shortLabel: 'Bovino · Sênior' } }, US: { 'senior-beef': { label: 'Beef Recipe for Senior Dogs', shortLabel: 'Beef · Senior' } } } });
    expect(item.flavorMix).toBe('Beef · Senior × 1');
  });

  test('names plans without catalog lines from their selected flavor keys', () => {
    const item = presentProductionQueueItem(baseRow({
      planSelection: { pets: [{ pet_name: 'Luna', selected_flavors: ['turkey'], flavor_weights: [3] }] }
    }), { recipeNames: { BR: { turkey: { label: 'Frango', shortLabel: '' } } } });
    expect(item.flavorMix).toBe('Frango × 3');
  });

  test('marks mixed pack sizes as dense misto', () => {
    const item = presentProductionQueueItem(baseRow({
      planSelection: {
        catalog_pricing: {
          line_items: [
            { flavor: 'beef', quantity: 1, pack_size_label: '500 g', pet_name: 'Luna' },
            { flavor: 'turkey', quantity: 1, pack_size_label: '300 g', pet_name: 'Luna' }
          ]
        }
      }
    }));

    expect(item.packSizeLabel).toBe('misto');
    expect(item.dense).toBe(true);
  });

  test('does not invent a subtotal when catalog_pricing.subtotal is missing', () => {
    const item = presentProductionQueueItem(baseRow({
      planSelection: {
        catalog_pricing: {
          grand_total: 200,
          line_items: [
            { flavor: 'beef', quantity: 2, pack_size_label: '500 g', pet_name: 'Luna' }
          ]
        }
      }
    }));

    expect(item.subtotal).toBeNull();
  });

  test('treats a missing cycle as to_prepare', () => {
    const item = presentProductionQueueItem(baseRow());
    expect(item.productionStatus).toBe('to_prepare');
    expect(item.note).toBeNull();
  });

  test('labels a civil-today period end as Vence hoje even after the UTC timestamp', () => {
    const item = presentProductionQueueItem(baseRow({
      currentPeriodEnd: '2026-09-20T08:00:00.000Z'
    }), {
      timezone: 'America/Sao_Paulo',
      now: new Date('2026-09-20T18:00:00.000Z')
    });

    expect(item.daysUntil).toBe(0);
    expect(item.dueBucket).toBe('today');
    expect(item.dueLabel).toBe('Vence hoje');
  });

  test('drops street, postal code, and payment last4', () => {
    const item = presentProductionQueueItem(baseRow());
    const serialized = JSON.stringify(item);

    expect(item.country).toBe('BR');
    expect(item.city).toBe('São Paulo');
    expect(serialized).not.toContain('Rua das Flores');
    expect(serialized).not.toContain('01310-000');
    expect(serialized).not.toContain('4242');
    expect(item.paymentMethodLast4).toBeUndefined();
  });

  test('uses ledger snapshot identity and flags out-of-scope profiles', () => {
    const inScope = presentProductionQueueItem(baseRow({ profileMarket: 'BR' }), {
      actor: { roles: ['operator'], markets: ['BR'], permissions: ['market.br'] }
    });
    const outOfScope = presentProductionQueueItem(baseRow({
      stripeAccount: 'us',
      profileMarket: 'BR',
      address: { country: 'US', city: 'Austin', name: 'Ada' }
    }), {
      actor: { roles: ['operator'], markets: ['US'], permissions: ['market.us'] }
    });

    expect(inScope.displayName).toBe('Ana Costa');
    expect(inScope.email).toBe('ana@edenbowls.com');
    expect(inScope.customerProfileInScope).toBe(true);
    expect(outOfScope.customerProfileInScope).toBe(false);
    expect(outOfScope.email).toBe('ana@edenbowls.com');
  });
});

describe('presentProductionQueueItem recipient', () => {
  test('shows the delivery recipient first', () => {
    const item = presentProductionQueueItem(baseRow({ address: { ...baseRow().address, recipient_name: 'João Lima' } }));
    expect(item.displayName).toBe('João Lima');
  });

  test('an old subscription without any name keeps the customer email', () => {
    const { name, ...address } = baseRow().address;
    const item = presentProductionQueueItem(baseRow({ address }));
    expect(item.displayName).toBe('ana@edenbowls.com');
  });
  // operator-fills-recipient-name: the account name comes before the email, only for a profile in scope.
  const brOperator = { roles: ['operator'], markets: ['BR'], permissions: ['market.br'] };
  const noName = () => {
    const { name, ...address } = baseRow().address;
    return address;
  };

  test('no recipient: the account name of a profile in scope, marked as such', () => {
    const item = presentProductionQueueItem(baseRow({ address: noName(), profileMarket: 'BR', accountDisplayName: ' Carla Dias ' }), { actor: brOperator });
    expect(item).toMatchObject({ displayName: 'Carla Dias', nameSource: 'account', accountName: 'Carla Dias' });
  });

  test('no recipient and a profile out of scope: the email, no account name', () => {
    const item = presentProductionQueueItem(baseRow({ address: noName(), profileMarket: 'US', accountDisplayName: 'Carla Dias' }), { actor: brOperator });
    expect(item).toMatchObject({ displayName: 'ana@edenbowls.com', nameSource: 'email', accountName: null, customerProfileInScope: false });
  });

  test('an account name that is an email is not a name', () => {
    const item = presentProductionQueueItem(baseRow({ address: noName(), profileMarket: 'BR', accountDisplayName: 'carla@x.com' }), { actor: brOperator });
    expect(item).toMatchObject({ displayName: 'ana@edenbowls.com', nameSource: 'email', accountName: null });
  });

  test('the recipient wins over the account name and still carries the suggestion', () => {
    const item = presentProductionQueueItem(baseRow({ profileMarket: 'BR', accountDisplayName: 'Carla Dias' }), { actor: brOperator });
    expect(item).toMatchObject({ nameSource: 'recipient', accountName: 'Carla Dias' });
    expect(item.displayName).not.toBe('Carla Dias');
  });
});

describe('presentProductionQueueItem boxes', () => {
  const lines = (...items) => ({ planSelection: { catalog_pricing: { currency: 'USD', line_items: items } } });

  test('Production queue item: 45 packs give two monthly boxes of 30 and 15', () => {
    const item = presentProductionQueueItem(baseRow({
      stripeAccount: 'us',
      address: { country: 'US', city: 'Miami' },
      ...lines(
        { flavor: 'beef', flavor_label: 'Beef', quantity: 25, pack_size_grams: 500, pet_name: 'Rex' },
        { flavor: 'chicken', flavor_label: 'Chicken', quantity: 20, pack_size_grams: 500, pet_name: 'Max' }
      )
    }));

    expect(item.boxes).toEqual([
      { key: 'monthly', label: 'Caixa mensal', pack_count: 30, weight_kg: 17 },
      { key: 'monthly', label: 'Caixa mensal', pack_count: 15, weight_kg: 9.5 }
    ]);
  });

  test('a BR box has no dry ice', () => {
    const item = presentProductionQueueItem(baseRow(lines({ flavor: 'frango', flavor_label: 'Frango', quantity: 10, pack_size_grams: 300 })));

    expect(item.boxes).toEqual([{ key: 'starter', label: 'Starter Box', pack_count: 10, weight_kg: 4 }]);
  });

  test('uses the saved boxes', () => {
    const shippingSettings = { us: { package: { dry_ice_kg: 0.5 }, boxes: {
      starter: { label: 'Starter Box', length_in: 14, width_in: 12, height_in: 8, empty_weight_kg: 1, max_packs: 10 },
      monthly: { label: 'Caixa mensal', length_in: 18, width_in: 14, height_in: 12, empty_weight_kg: 1.7, max_packs: 30 }
    } } };
    const item = presentProductionQueueItem(baseRow(lines({ flavor: 'frango', quantity: 12, pack_size_grams: 300 })), { shippingSettings });

    expect(item.boxes).toEqual([{ key: 'monthly', label: 'Caixa mensal', pack_count: 12, weight_kg: 5.3 }]);
  });

  test('unsized lines stay out of the boxes and are reported', () => {
    const onUnsizedLines = jest.fn();
    const item = presentProductionQueueItem(baseRow(lines(
      { flavor: 'frango', flavor_label: 'Frango', quantity: 4, pack_size_grams: 300 },
      { flavor: 'peixe', flavor_label: 'Peixe', quantity: 2 }
    )), { onUnsizedLines });

    expect(item.boxes).toEqual([{ key: 'starter', label: 'Starter Box', pack_count: 4, weight_kg: 2.2 }]);
    expect(onUnsizedLines).toHaveBeenCalledWith([expect.objectContaining({ flavorKey: 'peixe', quantity: 2, subscriptionId: 'sub_123' })]);
  });
});

