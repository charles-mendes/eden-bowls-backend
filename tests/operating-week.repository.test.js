const { OperatingWeekRepository } = require('../src/infrastructure/repositories/operating-week.repository');
const { DeliveryClosedDaysRepository } = require('../src/infrastructure/repositories/delivery-closed-days.repository');

const rows = [
  { market: 'BR', weekday: 2, open: 1, opens_at: '09:00:00', closes_at: '20:00:00' },
  { market: 'BR', weekday: 1, open: 1, opens_at: '08:30:00', closes_at: '18:00:00' },
  { market: 'BR', weekday: 7, open: 0, opens_at: '09:00:00', closes_at: '20:00:00' },
  { market: 'US', weekday: 1, open: 1, opens_at: '09:00:00', closes_at: '20:00:00' }
];

describe('OperatingWeekRepository', () => {
  test('reads seven days, Monday first, as HH:MM; a missing weekday reads as the default week', async () => {
    const repository = new OperatingWeekRepository({ query: jest.fn().mockResolvedValue(rows) });

    const week = await repository.get('BR');

    expect(week.map((day) => day.weekday)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(week[0]).toEqual({ weekday: 1, open: true, opensAt: '08:30', closesAt: '18:00' });
    expect(week[6]).toEqual({ weekday: 7, open: false, opensAt: '09:00', closesAt: '20:00' });
    expect(week[5]).toEqual({ weekday: 6, open: true, opensAt: '09:00', closesAt: '20:00' });
  });

  test('getBoth reads both markets in one query', async () => {
    const dataSource = { query: jest.fn().mockResolvedValue(rows) };
    const both = await new OperatingWeekRepository(dataSource).getBoth();
    expect(dataSource.query).toHaveBeenCalledTimes(1);
    expect(Object.keys(both)).toEqual(['BR', 'US']);
    expect(both.US.filter((day) => day.open).map((day) => day.weekday)).toEqual([1, 2, 3, 4, 5]);
  });

  test('saveIn upserts the seven days of one market inside the given transaction', async () => {
    const manager = { query: jest.fn().mockResolvedValue({}) };
    const days = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, open: weekday <= 5, opensAt: '09:00', closesAt: '20:00' }));

    const saved = await new OperatingWeekRepository({}).saveIn(manager, 'BR', days);

    const [sql, params] = manager.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO `delivery_operating_week`');
    expect(sql).toContain('ON DUPLICATE KEY UPDATE `open` = VALUES(`open`)');
    expect(params.slice(0, 5)).toEqual(['BR', 1, 1, '09:00:00', '20:00:00']);
    expect(params.slice(-5)).toEqual(['BR', 7, 0, '09:00:00', '20:00:00']);
    expect(saved[5]).toEqual({ weekday: 6, open: false, opensAt: '09:00', closesAt: '20:00' });
  });
});

describe('DeliveryClosedDaysRepository.snapshot', () => {
  test('returns the active closed days and both weeks together', async () => {
    const dataSource = { query: jest.fn().mockResolvedValue([]) };
    const operatingWeek = { getBoth: jest.fn().mockResolvedValue({ BR: [], US: [] }) };
    const repository = new DeliveryClosedDaysRepository(dataSource, { operatingWeek });

    const executor = { query: jest.fn().mockResolvedValue([]) };

    const snapshot = await repository.snapshot(executor);

    expect(snapshot).toEqual({ rows: [], week: { BR: [], US: [] } });
    expect(executor.query).toHaveBeenCalledTimes(1);
    expect(dataSource.query).not.toHaveBeenCalled();
    expect(operatingWeek.getBoth).toHaveBeenCalledWith(executor);
  });
});
