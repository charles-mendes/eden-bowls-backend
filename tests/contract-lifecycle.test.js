const { contractChargedCount, contractPaid, lastContractedDeliveryCharged } = require('../src/core/contract-deliveries');
const { SubscriptionLedgerRepository } = require('../src/infrastructure/repositories/subscription-ledger.repository');

// Deliveries left after a term change, with the contract started at the stored count.
const leftAfterChange = (charged, term) => {
  const row = { contractStartCharged: charged };
  return term - contractChargedCount(contractPaid(charged, row), term, true);
};

describe('contractPaid', () => {
  test('keeps the count with no base', () => expect(contractPaid(3, {})).toBe(3));
  test('subtracts the base', () => expect(contractPaid(5, { contractStartCharged: 3 })).toBe(2));
  test('keeps an unknown count unknown', () => expect(contractPaid(null, { contractStartCharged: 3 })).toBeNull());
  test('never goes below zero', () => expect(contractPaid(2, { contractStartCharged: 3 })).toBe(0));
});

describe('term change', () => {
  test.each([
    ['One month to three', 1, 3, 3],
    ['Three months to six', 3, 6, 6],
    ['Four charged, then six', 4, 6, 6],
    ['Shorter term', 2, 3, 3]
  ])('%s', (_name, charged, term, left) => {
    expect(leftAfterChange(charged, term)).toBe(left);
  });

  test('A year of contracts for one dog', () => {
    let charged = 0;
    let base = 0;
    for (const term of [1, 3, 1, 6]) {
      base = charged;
      charged += term;
      expect(lastContractedDeliveryCharged(contractPaid(charged - 1, { contractStartCharged: base }), term)).toBe(false);
      expect(lastContractedDeliveryCharged(contractPaid(charged, { contractStartCharged: base }), term)).toBe(true);
    }
  });
});

describe('deliveries of a contract', () => {
  test('First contract', () => {
    expect(3 - contractChargedCount(contractPaid(2, {}), 3, true)).toBe(1);
  });

  test('Renewal rolls into the next contract', () => {
    expect(3 - contractChargedCount(contractPaid(4, {}), 3, true)).toBe(2);
  });
});

test('startContract uses the stored count and handles an empty one', async () => {
  const query = jest.fn().mockResolvedValue({});
  await new SubscriptionLedgerRepository({ isInitialized: true, query }).startContract('sub_1');
  expect(query.mock.calls[0][0]).toContain('`contract_start_charged` = COALESCE(`charged_deliveries`, 0)');
  expect(query.mock.calls[0][1]).toEqual(['sub_1']);
});
