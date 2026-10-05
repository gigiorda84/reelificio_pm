// System health from public.job_health() (docs/fase1-plan.md §7.4): read by
// the job_health alert rule, the stand-up line and the drain's Sentry check.

export type JobHealth = {
  sweep_last_run: string | null;
  sweep_age_minutes: number | null;
  oldest_job_minutes: number | null;
  dead_letters_24h: number;
  violations: number;
  // Reels the last sweep could not process.
  sweep_errors: number;
};

export const HEALTH_LIMIT_MINUTES = 30;

export type HealthIssue = 'sweep_stale' | 'sweep_errors' | 'job_backlog' | 'dead_letters' | 'violations';

export function healthIssues(h: JobHealth | null): HealthIssue[] {
  if (!h) return ['sweep_stale'];
  const out: HealthIssue[] = [];
  if (h.sweep_age_minutes === null || h.sweep_age_minutes > HEALTH_LIMIT_MINUTES) out.push('sweep_stale');
  if ((h.sweep_errors ?? 0) > 0) out.push('sweep_errors');
  if ((h.oldest_job_minutes ?? 0) > HEALTH_LIMIT_MINUTES) out.push('job_backlog');
  if (h.dead_letters_24h > 0) out.push('dead_letters');
  if (h.violations > 0) out.push('violations');
  return out;
}
