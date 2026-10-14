import { describe, expect, it } from 'vitest';
import { buildReelCode } from './codes';

// The same cases as private._reel_code in scripts/db-check/checks/12_ideas.sql
// (docs/fase2-plan.md AC6): the app and the SQL build identical codes.
describe('buildReelCode', () => {
  it('pads month and ordinal to two digits and uppercases the prefix', () => {
    expect(buildReelCode('pp', 2026, 11, 1)).toBe('PP-2611-01');
    expect(buildReelCode('PP', 2026, 11, 12)).toBe('PP-2611-12');
  });

  it('keeps an ordinal of three digits whole', () => {
    expect(buildReelCode('PP', 2027, 1, 100)).toBe('PP-2701-100');
  });
});
