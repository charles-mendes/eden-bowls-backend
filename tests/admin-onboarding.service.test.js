const { AdminOnboardingService } = require('../src/services/admin-onboarding.service');

describe('AdminOnboardingService.csv', () => {
  function createService(items) {
    return new AdminOnboardingService({
      repository: {
        listCheckouts: jest.fn().mockResolvedValue({ total: items.length, items })
      }
    });
  }

  const checkout = {
    userId: '4',
    email: 'a@b.com',
    displayName: 'Ada',
    updatedAt: new Date('2026-08-19T03:46:00.000Z'),
    stripeStatus: 'mixed',
    stripeSubscriptionId: '2 vinculadas',
    frequency: 'monthly',
    termMonths: 1,
    firstInvoiceTotal: 99
  };

  test('formats updatedAt in the browser timezone and translates mixed/monthly', async () => {
    const service = createService([checkout]);
    const csv = await service.csv({ timezone: 'America/New_York' });

    expect(csv).toContain('23:46');
    expect(csv).toContain('18/08/2026');
    expect(csv).toContain('Misto');
    expect(csv).toContain('Mensal');
    expect(csv).not.toContain('mixed');
    expect(csv).not.toContain('monthly');
  });

  test('uses Brazil clock when the browser timezone is America/Sao_Paulo', async () => {
    const service = createService([checkout]);
    const csv = await service.csv({ timezone: 'America/Sao_Paulo' });

    expect(csv).toContain('00:46');
    expect(csv).toContain('19/08/2026');
  });

  test('falls back to UTC and does not send timezone to the repository', async () => {
    const repository = {
      listCheckouts: jest.fn().mockResolvedValue({ total: 1, items: [checkout] })
    };
    const service = new AdminOnboardingService({ repository });
    const csv = await service.csv({ timezone: 'Not/AZone', email: 'ada@' });

    expect(csv).toContain('03:46');
    expect(repository.listCheckouts).toHaveBeenCalledWith(
      { email: 'ada@' },
      { offset: 0, perPage: 10000 }
    );
  });
});
