// Moves a reel's open task back in time on staging, to see the semaforo, the
// sweep, overdue and escalation messages without waiting (docs/fase1-plan.md
// §7.3, E3). Staging only.
//
//   pnpm exec tsx scripts/fase1-time-travel.ts TT-2611-01 yellow     # just past 75%
//   pnpm exec tsx scripts/fase1-time-travel.ts TT-2611-01 due        # just past the deadline
//   pnpm exec tsx scripts/fase1-time-travel.ts TT-2611-01 escalate   # just past 150%
//   pnpm exec tsx scripts/fase1-time-travel.ts TT-2611-01 --hours 30 # all thresholds 30 h earlier
//
// Then run the sweep: pnpm exec tsx scripts/cron-loop.ts --once task-sweep
import { loadTarget } from './lib/target';

const POINTS = ['yellow', 'due', 'escalate'] as const;

async function main() {
  const { admin, args } = await loadTarget(process.argv.slice(2), { allowProduction: false });
  const [code, point] = args;
  const h = args.indexOf('--hours');
  if (!code || (!POINTS.includes(point as (typeof POINTS)[number]) && h < 0)) {
    throw new Error('usage: fase1-time-travel.ts <reel code> yellow|due|escalate | --hours N');
  }

  const { data: reel, error } = await admin.from('reels').select('id, code').eq('code', code).maybeSingle();
  if (error || !reel) throw new Error(`reel ${code} not found`);
  const { data: task } = await admin
    .from('tasks')
    .select('id, kind, status, started_at, yellow_at, due_at, escalate_at')
    .eq('reel_id', reel.id)
    .in('status', ['unassigned', 'assigned', 'in_progress'])
    .maybeSingle();
  if (!task?.due_at) throw new Error(`${code} has no open task with a deadline`);

  const target = h >= 0 ? null : (task as Record<string, string>)[`${point}_at`];
  const shiftMs = h >= 0
    ? Number(args[h + 1]) * 3_600_000
    : Date.now() - Date.parse(target!) + 60_000; // one minute past the threshold
  if (!Number.isFinite(shiftMs) || shiftMs <= 0) throw new Error('nothing to move: the threshold is already past');

  const back = (iso: string | null) => (iso ? new Date(Date.parse(iso) - shiftMs).toISOString() : null);
  const { error: updateError } = await admin
    .from('tasks')
    .update({
      started_at: back(task.started_at),
      yellow_at: back(task.yellow_at),
      due_at: back(task.due_at),
      escalate_at: back(task.escalate_at),
    })
    .eq('id', task.id);
  if (updateError) throw new Error(updateError.message);
  console.log(`${code} ${task.kind} (${task.status}): thresholds moved back ${(shiftMs / 3_600_000).toFixed(2)} h`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
