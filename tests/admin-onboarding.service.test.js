const { AdminOnboardingService, formatCsvTermLabel } = require('../src/services/admin-onboarding.service');

const CSV_HEADER = 'userId,email,displayName,updatedAt,stripeStatus,stripeSubscriptionId,frequency,termMonths,firstInvoiceTotal,termLabel';

function parseCsv(csv) {
  const lines = String(csv).replace(/\n$/, '').split('\n');
  const header = lines[0];
  const rows = lines.slice(1).filter(Boolean).map((line) => {
    const values = line.slice(1, -1).split('","');
    return Object.fromEntries(header.split(',').map((key, index) => [key, values[index]]));
  });
  return { header, rows };
}

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

    const parsed = parseCsv(csv);
    expect(parsed.header).toBe(CSV_HEADER);
    expect(csv.startsWith('\uFEFF')).toBe(false);
    expect(parsed.rows[0]).toMatchObject({
      frequency: 'Mensal',
      termMonths: '1',
      termLabel: '1 mês'
    });
  });

  test('formatCsvTermLabel matches list wording and uses empty cells for missing terms', () => {
    expect(formatCsvTermLabel(null)).toBe('');
    expect(formatCsvTermLabel('')).toBe('');
    expect(formatCsvTermLabel(0)).toBe('');
    expect(formatCsvTermLabel(1)).toBe('1 mês');
    expect(formatCsvTermLabel(3)).toBe('3 meses');
    expect(formatCsvTermLabel(6)).toBe('6 meses');
    expect(formatCsvTermLabel(12)).toBe('12 meses');
  });

  test('leaves termMonths and termLabel empty when the plan term is missing', async () => {
    const service = createService([{ ...checkout, termMonths: null }]);
    const csv = await service.csv({ timezone: 'UTC' });
    const parsed = parseCsv(csv);

    expect(parsed.header).toBe(CSV_HEADER);
    expect(parsed.rows[0].frequency).toBe('Mensal');
    expect(parsed.rows[0].termMonths).toBe('');
    expect(parsed.rows[0].termLabel).toBe('');
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

  test('filters list, metrics, and csv by onboarding market', async () => {
    const repository = {
      listCheckouts: jest.fn().mockResolvedValue({ total: 0, items: [] }),
      metrics: jest.fn().mockResolvedValue({ totalCheckouts: 0 })
    };
    const service = new AdminOnboardingService({ repository });
    const actor = { roles: ['operator'], markets: ['BR'] };

    await service.list({ email: 'ada@' }, { page: 1, perPage: 20, offset: 0 }, actor);
    await service.metrics({}, actor);
    await service.csv({ email: 'ada@' }, actor);

    expect(repository.listCheckouts).toHaveBeenCalledWith(
      { email: 'ada@', markets: ['BR'] },
      { offset: 0, page: 1, perPage: 20 }
    );
    expect(repository.metrics).toHaveBeenCalledWith({ markets: ['BR'] });
    expect(repository.listCheckouts).toHaveBeenCalledWith(
      { email: 'ada@', markets: ['BR'] },
      { offset: 0, perPage: 10000 }
    );
  });

  test('returns 404 for an out-of-scope session', async () => {
    const service = new AdminOnboardingService({
      repository: {
        getCheckout: jest.fn().mockResolvedValue({
          userId: '91',
          market: 'US',
          pets: [],
          address: { country: 'US' }
        })
      }
    });

    await expect(service.getByUserId('91', { roles: ['operator'], markets: ['BR'] })).rejects.toMatchObject({
      statusCode: 404
    });
  });
});
