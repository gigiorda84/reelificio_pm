import { describe, expect, it } from 'vitest';
import { detectBatchYearMonth, reelCodeYearMonth } from './codes';

// The year rule matches private._code_month (Fase 2, 040_ideas.sql): the
// label's month moves by a year when it is more than 6 months from now (Rome).
describe('detectBatchYearMonth', () => {
  it('codes a January batch imported in December as next year', () => {
    expect(detectBatchYearMonth('Batch Gennaio', new Date('2026-12-10T10:00:00Z'))).toEqual({
      year: 2027,
      month: 1,
    });
  });

  it('codes a December batch imported in January as the previous year', () => {
    expect(detectBatchYearMonth('Batch Dicembre', new Date('2027-01-05T10:00:00Z'))).toEqual({
      year: 2026,
      month: 12,
    });
  });

  it('keeps the current year for the same and nearby months', () => {
    const now = new Date('2026-10-15T10:00:00Z');
    expect(detectBatchYearMonth('Batch Ottobre', now)).toEqual({ year: 2026, month: 10 });
    expect(detectBatchYearMonth('BATCH NOVEMBRE', now)).toEqual({ year: 2026, month: 11 });
    expect(detectBatchYearMonth('Batch Settembre', now)).toEqual({ year: 2026, month: 9 });
  });

  it('keeps the current year at exactly 6 months either way', () => {
    expect(detectBatchYearMonth('Batch Gennaio', new Date('2026-07-15T10:00:00Z'))).toEqual({
      year: 2026,
      month: 1,
    });
    expect(detectBatchYearMonth('Batch Luglio', new Date('2026-01-15T10:00:00Z'))).toEqual({
      year: 2026,
      month: 7,
    });
  });

  it('reads now in Rome: 31 Dec 23:30 UTC is already January there', () => {
    const now = new Date('2026-12-31T23:30:00Z');
    expect(detectBatchYearMonth(null, now)).toEqual({ year: 2027, month: 1 });
    expect(detectBatchYearMonth('Batch senza mese', now)).toEqual({ year: 2027, month: 1 });
    expect(detectBatchYearMonth('Batch Gennaio', now)).toEqual({ year: 2027, month: 1 });
    // 6 months after Rome's January; from UTC's December it would be July 2026.
    expect(detectBatchYearMonth('Batch Luglio', now)).toEqual({ year: 2027, month: 7 });
  });
});

describe('reelCodeYearMonth', () => {
  it('reads the year and month of a reel code', () => {
    expect(reelCodeYearMonth('PP-2612-03')).toEqual({ year: 2026, month: 12 });
    expect(reelCodeYearMonth('PP-2701-100')).toEqual({ year: 2027, month: 1 });
  });

  it('returns null for anything that is not a reel code', () => {
    expect(reelCodeYearMonth('PP-2613-01')).toBeNull();
    expect(reelCodeYearMonth('PP-2600-01')).toBeNull();
    expect(reelCodeYearMonth('not a code')).toBeNull();
  });
});
