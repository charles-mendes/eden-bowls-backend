const { CourierDeliveryRepository } = require('../src/infrastructure/repositories/courier-delivery.repository');

function repositoryWith(query) {
  return new CourierDeliveryRepository({ isInitialized: true, query });
}

const squash = (sql) => sql.replace(/\s+/g, ' ');

describe('CourierDeliveryRepository', () => {
  test('insert maps a duplicate active invoice to inserted false', async () => {
    const error = Object.assign(new Error('Duplicate'), { code: 'ER_DUP_ENTRY' });
    const query = jest.fn().mockRejectedValue(error);

    await expect(repositoryWith(query).insert({ subscriptionId: 'sub_1', invoiceId: 'in_1', method: 'uber' }))
      .resolves.toEqual({ inserted: false, row: null });
  });

  test('insert stores an out-for-delivery row and returns it', async () => {
    const at = new Date('2026-11-04T12:00:00Z');
    const query = jest.fn()
      .mockResolvedValueOnce({ insertId: 7 })
      .mockResolvedValueOnce([{ id: 7, subscription_id: 'sub_1', stripe_invoice_id: 'in_1', method: 'uber', status: 'out_for_delivery', cost_minor: 1850 }]);

    const result = await repositoryWith(query).insert({
      subscriptionId: 'sub_1', userId: 3, stripeAccount: 'br', invoiceId: 'in_1', method: 'uber',
      courierName: 'Carlos', trackingUrl: 'https://trip.uber.com/abc', costMinor: 1850, note: 'Portão azul', outForDeliveryAt: at, actorId: 9
    });

    const [sql, params] = query.mock.calls[0];
    expect(squash(sql)).toContain("'brl', ?, 'out_for_delivery', ?, ?, ?)");
    expect(params).toEqual(['sub_1', 3, 'br', 'in_1', 'uber', 'Carlos', 'https://trip.uber.com/abc', 1850, 'Portão azul', at, 9, 9]);
    expect(result).toMatchObject({ inserted: true, row: { id: 7, cost_minor: 1850, status: 'out_for_delivery' } });
  });

  test('a final status only replaces out_for_delivery and reports the affected rows', async () => {
    const at = new Date('2026-11-04T15:00:00Z');
    const query = jest.fn().mockResolvedValue({ affectedRows: 0 });

    const affected = await repositoryWith(query).transition(7, 'failed', { at, reason: 'Ninguém em casa', actorId: 9 });

    const [sql, params] = query.mock.calls[0];
    expect(sql).toBe("UPDATE `courier_deliveries` SET `status` = ?, `failed_at` = ?, `updated_by` = ?, `failure_reason` = ? WHERE `id` = ? AND `status` = 'out_for_delivery'");
    expect(params).toEqual(['failed', at, 9, 'Ninguém em casa', 7]);
    expect(affected).toBe(0);
  });

  test('delivered and canceled stamp their own date', async () => {
    const query = jest.fn().mockResolvedValue({ affectedRows: 1 });
    const repository = repositoryWith(query);

    await expect(repository.transition(7, 'delivered', { at: 'd' })).resolves.toBe(1);
    await repository.transition(7, 'canceled', { at: 'c' });

    expect(query.mock.calls[0][0]).toContain('`delivered_at` = ?');
    expect(query.mock.calls[1][0]).toContain('`canceled_at` = ?');
    expect(query.mock.calls[1][0]).not.toContain('failure_reason');
  });

  test('editing details skips canceled rows and leaves status and dates alone', async () => {
    const query = jest.fn().mockResolvedValue({ affectedRows: 1 });

    await repositoryWith(query).updateDetails(7, { costMinor: 2000, note: '' }, 9);

    const [sql, params] = query.mock.calls[0];
    expect(sql).toBe("UPDATE `courier_deliveries` SET `cost_minor` = ?, `note` = ?, `updated_by` = ? WHERE `id` = ? AND `status` <> 'canceled'");
    expect(params).toEqual([2000, null, 9, 7]);
  });

  test('lists by invoice ids, by status and delivered since', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const repository = repositoryWith(query);

    await expect(repository.listByInvoiceIds([])).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
    await repository.listByInvoiceIds(['in_1', 'in_1', 'in_2']);
    await repository.listByStatus('failed');
    await repository.listDeliveredSince('2026-10-29 03:00:00');

    expect(query.mock.calls[0]).toEqual(['SELECT * FROM `courier_deliveries` WHERE `stripe_invoice_id` IN (?, ?) ORDER BY `id` DESC', ['in_1', 'in_2']]);
    expect(query.mock.calls[1][1]).toEqual(['failed']);
    expect(query.mock.calls[2][0]).toContain("`status` = 'delivered' AND `delivered_at` >= ?");
  });
});
