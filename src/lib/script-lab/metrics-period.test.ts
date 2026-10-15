import { describe, expect, it } from 'vitest';
import { metricsPeriod, monthLabel, parsePeriod, share } from './metrics-period';

describe('metricsPeriod', () => {
  it('takes the last N months in Rome, the current one included, plus next month for batches', () => {
    expect(metricsPeriod(3, new Date('2026-10-15T10:00:00Z'))).toEqual({
      from: '2026-08-01',
      to: '2026-12-01',
      months: ['2026-08', '2026-09', '2026-10'],
      next: '2026-11',
    });
  });

  it('crosses the year', () => {
    expect(metricsPeriod(6, new Date('2027-02-10T10:00:00Z'))).toEqual({
      from: '2026-09-01',
      to: '2027-04-01',
      months: ['2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02'],
      next: '2027-03',
    });
  });

  it('uses the Rome month at the turn of the month', () => {
    // 31 Oct 23:30 UTC is already 1 Nov in Rome.
    expect(metricsPeriod(1, new Date('2026-10-31T23:30:00Z'))).toEqual({
      from: '2026-11-01',
      to: '2027-01-01',
      months: ['2026-11'],
      next: '2026-12',
    });
  });
});

describe('parsePeriod', () => {
  it('accepts 3, 6 and 12 and falls back to 6', () => {
    expect(parsePeriod('3')).toBe(3);
    expect(parsePeriod(['12', '3'])).toBe(12);
    expect(parsePeriod('24')).toBe(6);
    expect(parsePeriod(undefined)).toBe(6);
  });
});

describe('monthLabel and share', () => {
  it('formats months in Italian', () => {
    expect(monthLabel('2026-10')).toBe('ott 2026');
  });

  it('divides only when there is something to divide', () => {
    expect(share(1, 5)).toBe(0.2);
    expect(share(0, 0)).toBeNull();
  });
});
