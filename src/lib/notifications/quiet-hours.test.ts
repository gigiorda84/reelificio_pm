import { describe, expect, it } from 'vitest';
import { isQuietHour } from './quiet-hours';

describe('isQuietHour', () => {
  it('silences Batch at night, Rome time', () => {
    expect(isQuietHour(new Date('2026-10-20T19:30:00Z'), 'batch')).toBe(true); // 21:30 CEST
    expect(isQuietHour(new Date('2026-10-20T05:59:00Z'), 'batch')).toBe(true); // 07:59 CEST
    expect(isQuietHour(new Date('2026-10-20T06:00:00Z'), 'batch')).toBe(false); // 08:00 CEST
    expect(isQuietHour(new Date('2026-10-20T17:59:00Z'), 'batch')).toBe(false); // 19:59 CEST
  });

  it('never silences Express', () => {
    expect(isQuietHour(new Date('2026-10-20T01:00:00Z'), 'express')).toBe(false);
  });

  it('follows the clock changes of 25/10/2026 and 28/03/2027', () => {
    // After the switch to CET 19:00 UTC is 20:00 in Rome.
    expect(isQuietHour(new Date('2026-10-24T19:00:00Z'), 'batch')).toBe(true); // 21:00 CEST
    expect(isQuietHour(new Date('2026-10-26T18:30:00Z'), 'batch')).toBe(false); // 19:30 CET
    expect(isQuietHour(new Date('2026-10-26T19:00:00Z'), 'batch')).toBe(true); // 20:00 CET
    // Back to CEST on 28/03/2027: the same 06:30 UTC is 07:30 before, 08:30 after.
    expect(isQuietHour(new Date('2027-03-27T06:30:00Z'), 'batch')).toBe(true); // 07:30 CET
    expect(isQuietHour(new Date('2027-03-29T06:30:00Z'), 'batch')).toBe(false); // 08:30 CEST
  });
});
