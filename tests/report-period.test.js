const { HttpError } = require('../src/core/http-error');
const {
  buildBuckets,
  foldHourlyRows,
  localMidnightUtc,
  publicPeriod,
  resolveReportPeriod
} = require('../src/core/report-period');

// 2026-10-28 15:00 in America/Sao_Paulo (UTC-3).
const NOW_BR = new Date('2026-10-28T18:00:00Z');

function expectInvalid(run) {
  try {
    run();
    throw new Error('expected report_period_invalid');
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    expect(error.statusCode).toBe(400);
    expect(error.details.code).toBe('report_period_invalid');
  }
}

describe('report period', () => {
  test('defaults to the 30 complete days ending yesterday with the previous window', () => {
    const period = resolveReportPeriod({}, { market: 'BR', now: NOW_BR });
    expect(publicPeriod(period)).toEqual({
      from: '2026-09-28',
      to: '2026-10-27',
      timezone: 'America/Sao_Paulo',
      granularity: 'day',
      partialToday: false,
      previous: { from: '2026-08-29', to: '2026-09-27' }
    });
    expect(period.range).toEqual({ start: '2026-09-28 03:00:00', end: '2026-10-28 03:00:00' });
    expect(period.previousRange).toEqual({ start: '2026-08-29 03:00:00', end: '2026-09-28 03:00:00' });
  });

  test('a window ending today stops now and cuts the previous window at the same local time', () => {
    const period = resolveReportPeriod({ from: '2026-10-22', to: '2026-10-28' }, { market: 'BR', now: NOW_BR });
    expect(period.partialToday).toBe(true);
    expect(period.previous).toEqual({ from: '2026-10-15', to: '2026-10-21' });
    expect(period.range.end).toBe('2026-10-28 18:00:00');
    expect(period.previousRange.end).toBe('2026-10-21 18:00:00');
  });

  test('clamps a future end to today', () => {
    const period = resolveReportPeriod({ from: '2026-10-01', to: '2026-12-31' }, { market: 'BR', now: NOW_BR });
    expect(period.to).toBe('2026-10-28');
    expect(period.partialToday).toBe(true);
  });

  test('rejects bad dates, inverted ranges, ranges over 366 days and unknown granularity', () => {
    const options = { market: 'BR', now: NOW_BR };
    expectInvalid(() => resolveReportPeriod({ from: '2026-02-30' }, options));
    expectInvalid(() => resolveReportPeriod({ from: '28/10/2026' }, options));
    expectInvalid(() => resolveReportPeriod({ from: '2026-10-10', to: '2026-10-01' }, options));
    expectInvalid(() => resolveReportPeriod({ from: '2025-01-01', to: '2026-10-28' }, options));
    expectInvalid(() => resolveReportPeriod({ granularity: 'hour' }, options));
    expect(resolveReportPeriod({ from: '2025-10-28', to: '2026-10-28' }, options).days).toBe(366);
  });

  test('picks day, week or month from the length unless one is given', () => {
    const options = { market: 'BR', now: NOW_BR };
    expect(resolveReportPeriod({ from: '2026-09-27', to: '2026-10-27' }, options).granularity).toBe('day');
    expect(resolveReportPeriod({ from: '2026-07-01', to: '2026-10-27' }, options).granularity).toBe('week');
    expect(resolveReportPeriod({ from: '2026-03-15', to: '2026-10-27' }, options).granularity).toBe('month');
    expect(resolveReportPeriod({ granularity: 'month' }, options).granularity).toBe('month');
  });

  test('a US invoice at 02:00 UTC on Oct 1 belongs to Sep 30 in New York', () => {
    const period = resolveReportPeriod({ from: '2026-10-01', to: '2026-10-07' }, { market: 'US', now: NOW_BR });
    expect(period.range.start).toBe('2026-10-01 04:00:00');
    expect('2026-10-01 02:00:00' < period.range.start).toBe(true);
  });

  test('local midnight follows the US daylight saving switches', () => {
    expect(new Date(localMidnightUtc('2026-03-08', 'America/New_York')).toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(new Date(localMidnightUtc('2026-03-09', 'America/New_York')).toISOString()).toBe('2026-03-09T04:00:00.000Z');
    expect(new Date(localMidnightUtc('2026-11-01', 'America/New_York')).toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(new Date(localMidnightUtc('2026-11-02', 'America/New_York')).toISOString()).toBe('2026-11-02T05:00:00.000Z');
  });

  test('weeks start on Monday and edge months are partial', () => {
    const weekly = buildBuckets(resolveReportPeriod({ from: '2026-10-01', to: '2026-10-27', granularity: 'week' }, { market: 'BR', now: NOW_BR }));
    expect(weekly[0]).toEqual({ key: '2026-09-28', from: '2026-10-01', to: '2026-10-04', partial: true });
    expect(weekly[1]).toEqual({ key: '2026-10-05', from: '2026-10-05', to: '2026-10-11', partial: false });
    expect(weekly[weekly.length - 1]).toEqual({ key: '2026-10-26', from: '2026-10-26', to: '2026-10-27', partial: true });

    const monthly = buildBuckets(resolveReportPeriod({ from: '2026-03-15', to: '2026-10-27' }, { market: 'BR', now: NOW_BR }));
    expect(monthly.map((bucket) => [bucket.key, bucket.partial])).toEqual([
      ['2026-03-01', true], ['2026-04-01', false], ['2026-05-01', false], ['2026-06-01', false],
      ['2026-07-01', false], ['2026-08-01', false], ['2026-09-01', false], ['2026-10-01', true]
    ]);
  });

  test('a day bucket for a running today is partial', () => {
    const buckets = buildBuckets(resolveReportPeriod({ from: '2026-10-27', to: '2026-10-28' }, { market: 'BR', now: NOW_BR }));
    expect(buckets.map((bucket) => bucket.partial)).toEqual([false, true]);
  });

  test('folds UTC hours into local buckets and fills empty ones with zero', () => {
    const period = resolveReportPeriod({ from: '2026-08-03', to: '2026-10-25', granularity: 'week' }, { market: 'BR', now: NOW_BR });
    const buckets = foldHourlyRows([
      { hour: '2026-08-03 03', revenue: 1000, invoices: 1 },
      { hour: '2026-08-04 02', revenue: 500, invoices: 1 },
      { hour: '2026-08-03 02', revenue: 999, invoices: 9 },
      { hour: '2026-10-25 23', revenue: 200, invoices: 1 }
    ], period, ['revenue', 'invoices']);

    expect(buckets).toHaveLength(12);
    expect(buckets[0]).toMatchObject({ key: '2026-08-03', revenue: 1500, invoices: 2 });
    expect(buckets[4]).toMatchObject({ revenue: 0, invoices: 0 });
    expect(buckets[11]).toMatchObject({ key: '2026-10-19', revenue: 200, invoices: 1 });
  });
});
