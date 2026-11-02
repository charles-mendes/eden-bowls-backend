const { UpsShipmentRepository } = require('../src/infrastructure/repositories/ups-shipment.repository');
const { AddUpsShipmentsActiveInvoiceUnique1700000000030 } = require('../src/infrastructure/migrations/1700000000030-add-ups-shipments-active-invoice-unique');

function repositoryWith(query) {
  return new UpsShipmentRepository({ isInitialized: true, query });
}

describe('UpsShipmentRepository tracking', () => {
  test('keeps the purchase answer in raw_response and can only deliver a created label', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const payload = { trackResponse: {} };

    await repositoryWith(query).recordTracking(9, { status: 'delivered', description: 'Delivered', deliveredAt: '2026-05-12 14:46:53' }, payload);

    const [sql, params] = query.mock.calls[0];
    expect(sql).not.toContain('`raw_response`');
    expect(sql).toContain("WHEN ? = 'delivered' AND `status` = 'created' THEN 'delivered'");
    expect(params).toEqual(['delivered', 'Delivered', '2026-05-12 14:46:53', JSON.stringify(payload), 'delivered', 9]);
  });

  test('an answer without a package keeps the last status', async () => {
    const query = jest.fn().mockResolvedValue([]);

    await repositoryWith(query).recordTracking(9, null, {});

    expect(query.mock.calls[0][1].slice(0, 3)).toEqual([null, null, null]);
  });

  test('a delivered label still counts as labeled for the invoice', async () => {
    const query = jest.fn().mockResolvedValue([]);

    await repositoryWith(query).listByInvoiceIds(['in_1']);

    expect(query.mock.calls[0][0]).toContain("`status` IN ('created', 'delivered')");
  });
});

describe('UpsShipmentRepository idempotency', () => {
  test('an unknown row still counts as active for the invoice', async () => {
    const query = jest.fn().mockResolvedValue([]);
    await repositoryWith(query).findActiveByInvoiceId('in_1');

    expect(query.mock.calls[0][0]).toContain("`status` <> 'voided'");
    expect(query.mock.calls[0][1]).toEqual(['in_1']);
  });

  test('insertPending returns null on the active-invoice unique key', async () => {
    const duplicate = Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY', errno: 1062 });
    const query = jest.fn().mockRejectedValue(duplicate);

    await expect(repositoryWith(query).insertPending({ subscriptionId: 'sub_1', invoiceId: 'in_1' })).resolves.toBeNull();
  });

  test('insertPending rethrows other database errors', async () => {
    const query = jest.fn().mockRejectedValue(new Error('connection lost'));

    await expect(repositoryWith(query).insertPending({ subscriptionId: 'sub_1', invoiceId: 'in_1' })).rejects.toThrow('connection lost');
  });

  test('markUnknown only moves a pending row', async () => {
    const query = jest.fn().mockResolvedValue([]);
    await repositoryWith(query).markUnknown(9);

    expect(query.mock.calls[0][0]).toContain("SET `status` = 'unknown' WHERE `id` = ? AND `status` = 'pending'");
    expect(query.mock.calls[0][1]).toEqual([9]);
  });
});

describe('AddUpsShipmentsActiveInvoiceUnique1700000000030', () => {
  function runner({ duplicates = [], hasColumn = false, hasIndex = false } = {}) {
    return {
      hasTable: jest.fn().mockResolvedValue(true),
      hasColumn: jest.fn().mockResolvedValue(hasColumn),
      getTable: jest.fn(),
      query: jest.fn().mockImplementation(async (sql) => {
        if (sql.includes('information_schema.STATISTICS')) return hasIndex ? [{ found: 1 }] : [];
        if (sql.startsWith('SELECT')) return duplicates;
        return undefined;
      })
    };
  }

  function writes(queryRunner) {
    return queryRunner.query.mock.calls
      .map(([sql]) => sql.replace(/\s+/g, ' '))
      .filter((sql) => !sql.startsWith('SELECT'));
  }

  test('adds a generated column that is NULL for voided rows and a unique index on it', async () => {
    const queryRunner = runner();
    await new AddUpsShipmentsActiveInvoiceUnique1700000000030().up(queryRunner);

    const statements = writes(queryRunner);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("ADD COLUMN active_invoice_id VARCHAR(191) GENERATED ALWAYS AS (CASE WHEN status = 'voided' THEN NULL ELSE stripe_invoice_id END) STORED");
    expect(statements[1]).toBe('CREATE UNIQUE INDEX uq_ups_shipments_active_invoice ON ups_shipments (active_invoice_id)');
    expect(queryRunner.getTable).not.toHaveBeenCalled();
  });

  test('stops before altering when an invoice already has two active shipments', async () => {
    const queryRunner = runner({ duplicates: [{ stripe_invoice_id: 'in_dup' }] });

    await expect(new AddUpsShipmentsActiveInvoiceUnique1700000000030().up(queryRunner)).rejects.toThrow(/in_dup/);
    expect(writes(queryRunner)).toEqual([]);
  });

  test('a second run changes nothing and down removes both', async () => {
    const migrated = runner({ hasColumn: true, hasIndex: true });
    await new AddUpsShipmentsActiveInvoiceUnique1700000000030().up(migrated);
    expect(writes(migrated)).toEqual([]);

    await new AddUpsShipmentsActiveInvoiceUnique1700000000030().down(migrated);
    expect(writes(migrated)).toEqual([
      'DROP INDEX uq_ups_shipments_active_invoice ON ups_shipments',
      'ALTER TABLE ups_shipments DROP COLUMN active_invoice_id'
    ]);
  });
});
