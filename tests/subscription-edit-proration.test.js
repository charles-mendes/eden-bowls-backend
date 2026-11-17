const { mapProrationFromInvoice } = require('../src/core/subscription-edit-plan');

const cycle = (amount) => ({ amount, parent: { subscription_item_details: { proration: false } } });
const proration = (amount, extra = {}) => ({
  amount,
  parent: { subscription_item_details: { proration: true } },
  ...extra
});
const invoice = (lines, extra = {}) => ({ currency: 'brl', lines: { data: lines }, ...extra });

describe('mapProrationFromInvoice', () => {
  test('Term change alone: the next invoice is not due now', () => {
    expect(mapProrationFromInvoice(invoice([cycle(43750)], { amount_due: 43750 }))).toEqual({
      direction: 'none', amount_due_now: 0, credit_applied: 0, currency: 'BRL'
    });
  });

  test('More packs: only the adjustment is due now', () => {
    const lines = [cycle(141735 - 4485), proration(-67267), proration(71752)];
    expect(mapProrationFromInvoice(invoice(lines, { amount_due: 141735 }))).toMatchObject({
      direction: 'charge', amount_due_now: 44.85, credit_applied: 0
    });
  });

  test('Fewer packs: the adjustment is a credit, not a charge', () => {
    const lines = [cycle(128250), proration(-71752), proration(67268)];
    expect(mapProrationFromInvoice(invoice(lines, { amount_due: 123766 }))).toMatchObject({
      direction: 'credit', amount_due_now: 0, credit_applied: 44.84
    });
  });

  test('reads the older proration flag', () => {
    expect(mapProrationFromInvoice(invoice([{ amount: 500, proration: true }])).amount_due_now).toBe(5);
  });

  test('takes discounts off the adjustment', () => {
    const line = proration(1000, { discount_amounts: [{ amount: 100 }] });
    expect(mapProrationFromInvoice(invoice([line])).amount_due_now).toBe(9);
  });

  test('adds exclusive tax and leaves inclusive tax alone', () => {
    const line = proration(1000, {
      taxes: [{ amount: 80, tax_behavior: 'exclusive' }, { amount: 50, tax_behavior: 'inclusive' }]
    });
    expect(mapProrationFromInvoice(invoice([line])).amount_due_now).toBe(10.8);
  });

  test('a balance the customer already holds is not an effect of the edit', () => {
    expect(mapProrationFromInvoice(invoice([cycle(43750)], { starting_balance: -5000 }))).toMatchObject({
      direction: 'none', credit_applied: 0
    });
  });
});
