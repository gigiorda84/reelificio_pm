import 'server-only';
import { drainOutbox, type DrainReport } from '@/lib/jobs/drain';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';

// One sweep (docs/fase1-plan.md §S4): the SQL expires unanswered
// acceptances, stamps overdue and escalation thresholds and queues their
// messages (heartbeat included); then the outbox is emptied. Independent of
// the transport: the Vercel cron calls it today, Inngest or pg_cron could.
// The drain runs even when the sweep fails: retries and expired leases must
// not wait for the sweep to recover.
export async function runTaskSweep(now: Date = new Date()): Promise<{ sweep: Record<string, unknown>; drain: DrainReport }> {
  const { data, error } = await getSupabaseAdminClient().rpc('sweep_tasks', { p_now: now.toISOString() });
  const drain = await drainOutbox({ limit: 100 });
  if (error) throw new Error(`sweep_tasks: ${error.message} (drain: ${JSON.stringify(drain)})`);
  return { sweep: data as Record<string, unknown>, drain };
}
