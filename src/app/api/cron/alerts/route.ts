import { NextResponse, type NextRequest } from 'next/server';
import { evaluateAlerts } from '@/lib/alerts/evaluator';

export const runtime = 'nodejs';
// Vercel Cron + manual triggers only. Public path is allowed (see proxy.ts),
// but the handler requires the CRON_SECRET bearer.
export const dynamic = 'force-dynamic';

function authorize(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get('authorization') ?? '';
  if (header === `Bearer ${expected}`) return true;
  // Vercel Cron sends the same header automatically; allow ?secret=... as a
  // manual-trigger fallback for ad-hoc runs from a trusted shell.
  const qs = req.nextUrl.searchParams.get('secret');
  return qs === expected;
}

export async function GET(req: NextRequest) {
  if (!authorize(req)) {
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
