const { BlingNfeRepository } = require('../src/infrastructure/repositories/bling-nfe.repository');

// admin-flow-fixes-4 (PM-25): the courier queue reads the notes of a page at once.
describe('BlingNfeRepository.listByStripeInvoices', () => {
  test('reads every pair in one query, in order', async () => {
    const query = jest.fn().mockResolvedValue([{ id: 3, status: 'authorized', stripe_account: 'br', stripe_invoice_id: 'in_1', nfe_number: '123' }]);
    const rows = await new BlingNfeRepository({ query }).listByStripeInvoices([
      { stripeAccount: 'br', stripeInvoiceId: 'in_1' },
      { stripeAccount: 'br', stripeInvoiceId: 'in_2' }
    ]);

    const [sql, params] = query.mock.calls[0];
    expect(sql).toBe('SELECT * FROM `bling_nfe` WHERE (`stripe_account`, `stripe_invoice_id`) IN ((?, ?), (?, ?))');
    expect(params).toEqual(['br', 'in_1', 'br', 'in_2']);
    expect(rows[0]).toMatchObject({ id: 3, status: 'authorized', stripeAccount: 'br', stripeInvoiceId: 'in_1', nfeNumber: '123' });
  });

  test('sends no query for an empty list', async () => {
    const query = jest.fn();
    await expect(new BlingNfeRepository({ query }).listByStripeInvoices([])).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});
