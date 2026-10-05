import 'server-only';
import * as Sentry from '@sentry/nextjs';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { healthIssues, type JobHealth } from './health';
import { handleNotifyJob, PermanentJobError, type ClaimedJob } from './notify';

// Empties the outbox (docs/fase1-plan.md §S4): claim → handler → complete or
// fail. Transport-agnostic: called after server actions and the Telegram
// webhook (`after()`), and by the task-sweep cron. Claims carry a lease and
// a fencing token, so concurrent drains never run a job twice at once.

export type DrainReport = { claimed: number; done: number; retried: number; dead: number; stale: number };

function log(fields: Record<string, unknown>) {
  console.log(JSON.stringify({ evt: 'drain', ...fields }));
}

async function runJob(job: ClaimedJob): Promise<'sent' | 'stale'> {
  if (job.kind === 'notify') return handleNotifyJob(job);
  // drive_reconcile is queued only once Drive is on (R2, S5).
  throw new Error(`no handler for ${job.kind} yet`);
}

// Claims a few jobs at a time and stops at the deadline, well inside the
// route's maxDuration (60 s) and the 2-minute lease: what is left stays
// pending for the next drain instead of sitting leased by a killed function.
const CHUNK = 10;

export async function drainOutbox({ limit = 20, deadlineMs = 45_000 }: { limit?: number; deadlineMs?: number } = {}): Promise<DrainReport> {
  const admin = getSupabaseAdminClient();
  const report: DrainReport = { claimed: 0, done: 0, retried: 0, dead: 0, stale: 0 };
  const stopAt = Date.now() + deadlineMs;

  while (report.claimed < limit && Date.now() < stopAt) {
    const { data, error } = await admin.rpc('claim_jobs', { p_limit: Math.min(CHUNK, limit - report.claimed) });
    if (error) {
      log({ level: 'error', step: 'claim', error: error.message });
      Sentry.captureException(new Error(`claim_jobs: ${error.message}`));
      break;
    }
    const jobs = (data ?? []) as ClaimedJob[];
    if (jobs.length === 0) break;
    report.claimed += jobs.length;
    for (const job of jobs) await runOne(admin, job, report);
  }

  await reportStaleSweep();
  return report;
}

async function runOne(admin: ReturnType<typeof getSupabaseAdminClient>, job: ClaimedJob, report: DrainReport) {
  const started = Date.now();
  try {
    const outcome = await runJob(job);
    if (outcome === 'stale') report.stale += 1;
    const { data: code } = await admin.rpc('complete_job', {
      p_id: job.id,
      p_gen: job.gen,
      p_lease_token: job.lease_token,
    });
    report.done += 1;
    log({ job: job.id, kind: job.kind, event: job.payload.event, outcome, code, ms: Date.now() - started });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const { data: code } = await admin.rpc('fail_job', {
      p_id: job.id,
      p_lease_token: job.lease_token,
      p_error: message,
      p_retry: !(err instanceof PermanentJobError),
    });
    if (code === 'dead') {
      report.dead += 1;
      Sentry.captureException(err instanceof Error ? err : new Error(message), {
        tags: { job_kind: job.kind, event: String(job.payload.event ?? '') },
        extra: { job_id: job.id, attempts: job.attempts },
      });
    } else {
      report.retried += 1;
    }
    log({ level: 'warn', job: job.id, kind: job.kind, event: job.payload.event, code, error: message.slice(0, 300), ms: Date.now() - started });
  }
}

// The sweep cron should run every 5 minutes: if its heartbeat is older than
// 30 minutes, tell Sentry, at most once an hour per instance. Production
// only (staging and development have no cron).
let lastStaleReport = 0;
async function reportStaleSweep() {
  if (process.env.VERCEL_ENV !== 'production' || Date.now() - lastStaleReport < 3_600_000) return;
  const { data } = await getSupabaseAdminClient().rpc('job_health');
  if (!healthIssues(data as JobHealth | null).includes('sweep_stale')) return;
  lastStaleReport = Date.now();
  Sentry.captureMessage('task sweep heartbeat older than 30 minutes', {
    level: 'warning',
    extra: { health: data },
  });
}
