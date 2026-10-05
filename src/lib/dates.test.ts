import { describe, expect, it } from 'vitest';
import { formatRome } from './dates';

describe('formatRome', () => {
  it('shows Rome time, not the server zone', () => {
    // 16:00 UTC is 18:00 in Rome in summer (CEST) and 17:00 in winter (CET).
    expect(formatRome('2026-10-23T16:00:00Z')).toContain('18:00');
    expect(formatRome('2026-11-23T16:00:00Z')).toContain('17:00');
  });
});
