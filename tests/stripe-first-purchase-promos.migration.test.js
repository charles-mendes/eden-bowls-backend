const { CreateStripeFirstPurchasePromosTable1700000000008 } = require('../src/infrastructure/migrations/1700000000008-create-stripe-first-purchase-promos-table');

describe('CreateStripeFirstPurchasePromosTable1700000000008', () => {
  test('creates promo mapping and misconfig metric tables', async () => {
    const queryRunner = {
      hasTable: jest.fn().mockResolvedValue(false),
      createTable: jest.fn().mockResolvedValue(undefined)
    };

    await new CreateStripeFirstPurchasePromosTable1700000000008().up(queryRunner);

    const createdTables = queryRunner.createTable.mock.calls.map(([table]) => table);
    expect(createdTables.map((table) => table.name)).toEqual([
      'stripe_first_purchase_promos',
      'stripe_first_purchase_promo_metrics'
    ]);
    expect(createdTables[0].columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'term_months',
      'promotion_code_id',
      'coupon_id'
    ]));
    expect(createdTables[1].columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'metric_key',
      'metric_value'
    ]));
  });
});
