const { SubscriptionDeliveriesRepository } = require('../src/infrastructure/repositories/subscription-deliveries.repository');

describe('SubscriptionDeliveriesRepository.listForMarket', () => {
  test('maps every deliverable row of the market account without asking Stripe', async () => {
    const ledgerRepository = {
      listDeliverableByAccount: jest.fn().mockResolvedValue([
        { id: 3, userId: 7, stripeSubscriptionId: 'sub_3', stripeAccount: 'us', status: 'trialing', currentPeriodEnd: '2027-12-21T05:00:00.000Z', chargedDeliveries: null, subscriptionTermMonths: 3 }
      ])
    };
    const productionRepository = {
      findBySubscriptionAndPeriodEnd: jest.fn().mockResolvedValue({ status: 'to_prepare' }),
      findOpenPaidCycle: jest.fn().mockResolvedValue(null)
    };
    const stripeAccounts = { get: jest.fn() };
    const repository = new SubscriptionDeliveriesRepository({
      ledgerRepository, productionRepository, stripeAccounts, now: () => new Date('2027-12-10T15:00:00Z')
    });

    const [item] = await repository.listForMarket('US');

    expect(ledgerRepository.listDeliverableByAccount).toHaveBeenCalledWith('us');
    expect(productionRepository.findOpenPaidCycle).toHaveBeenCalledWith(3, '2027-12-10');
    expect(item).toMatchObject({ stripeSubscriptionId: 'sub_3', market: 'US', status: 'trialing', chargedCount: null, productionStatus: 'to_prepare' });
    expect(item.chargeAt.toISOString()).toBe('2027-12-21T05:00:00.000Z');
    expect(stripeAccounts.get).not.toHaveBeenCalled();
  });
});

const runIntegration = process.env.RUN_DB_INTEGRATION_TESTS === 'true';
const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration('SubscriptionLedgerRepository.listDeliverableByAccount (MySQL)', () => {
  require('dotenv').config();
  const { DataSource } = require('typeorm');
  const { SubscriptionLedgerRepository } = require('../src/infrastructure/repositories/subscription-ledger.repository');
  const dataSource = new DataSource({
    type: 'mysql',
    host: process.env.INTEGRATION_DB_HOST || process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.INTEGRATION_DB_PORT || process.env.DB_PORT || 3310),
    username: process.env.INTEGRATION_DB_USER || process.env.DB_USER || 'eden_bowls',
    password: process.env.INTEGRATION_DB_PASSWORD || process.env.DB_PASSWORD || 'eden_bowls',
    database: process.env.INTEGRATION_DB_NAME || process.env.DB_NAME || 'eden_bowls',
    timezone: 'Z',
    entities: [],
    synchronize: false,
    logging: false
  });

  beforeAll(() => dataSource.initialize());
  afterAll(() => dataSource.destroy());

  test('returns only deliverable rows of the account', async () => {
    const rows = await new SubscriptionLedgerRepository(dataSource).listDeliverableByAccount('us');
    for (const row of rows) {
      expect(row.stripeAccount).toBe('us');
      expect(['active', 'trialing', 'past_due']).toContain(row.status);
      expect(row.cancelAtPeriodEnd).toBe(false);
    }
  });
});
