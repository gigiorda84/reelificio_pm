import { NextResponse, type NextRequest } from 'next/server';
import { evaluateAlerts } from '@/lib/alerts/evaluator';
import { isAuthorizedCronRequest } from '@/lib/auth/cron';

export const runtime = 'nodejs';
// Vercel Cron + manual triggers only. Public path is allowed (see proxy.ts),
// but the handler requires the CRON_SECRET bearer.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  try {
    const report = await evaluateAlerts();
    return NextResponse.json({ ok: true, ...report });
  } catch (err) {
    console.error('[cron/alerts] failed', err);
    return NextResponse.json(
      { ok: false, error: 'evaluator_failed' },
      { status: 500 },
    );
  }
}
