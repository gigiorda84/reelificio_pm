import { describe, expect, it } from 'vitest';
import { healthIssues, type JobHealth } from './health';

const ok: JobHealth = {
  sweep_last_run: '2026-10-20T06:25:00Z',
  sweep_age_minutes: 5,
  oldest_job_minutes: 2,
  dead_letters_24h: 0,
  violations: 0,
  sweep_errors: 0,
};

describe('healthIssues', () => {
  it('nothing when all is well', () => {
    expect(healthIssues(ok)).toEqual([]);
  });

  it('a sweep that never ran or stopped more than 30 minutes ago', () => {
    expect(healthIssues(null)).toEqual(['sweep_stale']);
    expect(healthIssues({ ...ok, sweep_age_minutes: null })).toEqual(['sweep_stale']);
    expect(healthIssues({ ...ok, sweep_age_minutes: 31 })).toEqual(['sweep_stale']);
  });

  it('reels the sweep failed, a queue stuck, dead letters, inconsistent reels', () => {
    expect(healthIssues({ ...ok, sweep_errors: 1, oldest_job_minutes: 45, dead_letters_24h: 2, violations: 1 }))
      .toEqual(['sweep_errors', 'job_backlog', 'dead_letters', 'violations']);
  });

  it('animations waiting for their Drive kit (absent before S5: fine)', () => {
    expect(healthIssues({ ...ok, kit_waiting: 2 })).toEqual(['kit_waiting']);
    expect(healthIssues({ ...ok, kit_waiting: 0 })).toEqual([]);
  });
});
