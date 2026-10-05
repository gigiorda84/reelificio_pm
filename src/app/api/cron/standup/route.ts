import { NextResponse, type NextRequest } from 'next/server';
import { isAuthorizedCronRequest } from '@/lib/auth/cron';
import { runStandup } from '@/lib/standup/run';

export const runtime = 'nodejs';
// 06:30 and 07:30 UTC (Vercel Pro cron, release step 6): only the run at
// 08:30 Rome sends. `?force=1` (still behind the CRON_SECRET bearer) sends
// now, for a manual run on staging.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  try {
    const result = await runStandup({ force: req.nextUrl.searchParams.get('force') === '1' });
    console.log(JSON.stringify({ evt: 'standup', ...result }));
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[cron/standup] failed', err);
    return NextResponse.json({ ok: false, error: 'standup_failed' }, { status: 500 });
  }
}
