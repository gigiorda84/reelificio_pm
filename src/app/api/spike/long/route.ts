import { after, NextResponse, type NextRequest } from 'next/server';
import { isAuthorizedCronRequest } from '@/lib/auth/cron';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';

// Throwaway probe for Fase 2 S0 (docs/fase2-plan.md D-C): how long a
// function really runs on the Vercel plan in use, before S6 relies on it.
//   ?mode=inline  waits 200 s inside the request
//   ?mode=after   answers at once, then works 150 s inside after()
// Both log every 30 s and record the outcome in system_heartbeats
// ('spike_inline' / 'spike_after'), so a cut-off run shows as a row that
// never reaches `finished`. Runs only against the Fase 2 sandbox and needs
// the CRON_SECRET bearer. Removed when the probe is repeated on Vercel Pro.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const SANDBOX_REF = 'vgpjcqttekxxnkaeyhmh';

async function record(name: string, report: Record<string, unknown>) {
  const { error } = await getSupabaseAdminClient()
    .from('system_heartbeats')
    .upsert({ name, last_run_at: new Date().toISOString(), last_report: report });
  if (error) console.error(`[spike/long] ${name}: ${error.message}`);
}

async function work(name: string, seconds: number, startedAt: number) {
  await record(name, { started: new Date(startedAt).toISOString(), seconds, finished: false });
  for (let t = 30; t <= seconds; t += 30) {
    await new Promise((r) => setTimeout(r, 30_000));
    console.log(JSON.stringify({ evt: 'spike_long', name, elapsed_s: Math.round((Date.now() - startedAt) / 1000) }));
    await record(name, { started: new Date(startedAt).toISOString(), seconds, elapsed_s: t, finished: false });
  }
  await record(name, {
    started: new Date(startedAt).toISOString(),
    seconds,
    finished: true,
    elapsed_s: Math.round((Date.now() - startedAt) / 1000),
    region: process.env.VERCEL_REGION ?? 'local',
  });
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').includes(SANDBOX_REF)) {
    return NextResponse.json({ ok: false, error: 'sandbox_only' }, { status: 403 });
  }
  const startedAt = Date.now();
  const mode = req.nextUrl.searchParams.get('mode');
  if (mode === 'after') {
    after(() => work('spike_after', 150, startedAt));
    return NextResponse.json({ ok: true, mode, note: 'see system_heartbeats.spike_after' });
  }
  if (mode === 'inline') {
    await work('spike_inline', 200, startedAt);
    return NextResponse.json({ ok: true, mode, elapsed_s: Math.round((Date.now() - startedAt) / 1000) });
  }
  return NextResponse.json({ ok: false, error: 'mode must be inline or after' }, { status: 400 });
}
