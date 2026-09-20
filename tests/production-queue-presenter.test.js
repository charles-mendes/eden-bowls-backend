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
          { flavor: 'beef', quantity: 2, pack_size_label: '500 g', pet_name: 'Luna' },
          { flavor: 'turkey', quantity: 1, pack_size_label: '500 g', pet_name: 'Luna' }
        ]
      }
    },
    ...overrides
  };
}

describe('presentProductionQueueItem', () => {
  test('flattens catalog line items into mix, packs, and compact lineItems', () => {
    const item = presentProductionQueueItem(baseRow(), {
      timezone: 'America/Sao_Paulo',
      now: new Date('2026-09-20T15:00:00.000Z')
    });

    expect(item.flavorMix).toBe('beef × 2, turkey × 1');
    expect(item.packCount).toBe(3);
    expect(item.packSizeLabel).toBe('500 g');
    expect(item.subtotal).toBe(189.9);
    expect(item.dense).toBe(false);
    expect(item.lineItems).toEqual([
      { flavor: 'beef', quantity: 2, packSize: '500 g', petName: 'Luna' },
      { flavor: 'turkey', quantity: 1, packSize: '500 g', petName: 'Luna' }
    ]);
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
});
