import { NextResponse, type NextRequest } from 'next/server';
import { isAuthorizedCronRequest } from '@/lib/auth/cron';
import { runTaskSweep } from '@/lib/tasks/sweep';

export const runtime = 'nodejs';
// Every 5 minutes (Vercel Pro cron, release step 6); on staging
// scripts/cron-loop.ts calls it. Requires the CRON_SECRET bearer.
export const dynamic = 'force-dynamic';
// Well under the 5-minute job lease (fencing, docs/fase1-plan.md §S4).
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  try {
    const report = await runTaskSweep();
    console.log(JSON.stringify({ evt: 'task_sweep', ...report.sweep, drain: report.drain }));
    return NextResponse.json({ ok: true, ...report });
  } catch (err) {
    console.error('[cron/task-sweep] failed', err);
    return NextResponse.json({ ok: false, error: 'sweep_failed' }, { status: 500 });
  }
}
