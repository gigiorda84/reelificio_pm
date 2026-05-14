import { NextResponse, type NextRequest } from 'next/server';
import { sendWeeklyDigest } from '@/lib/digest/weekly';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorize(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get('authorization') ?? '';
  if (header === `Bearer ${expected}`) return true;
  const qs = req.nextUrl.searchParams.get('secret');
  return qs === expected;
}

export async function GET(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  try {
    const report = await sendWeeklyDigest();
    return NextResponse.json({ ok: true, ...report });
  } catch (err) {
    console.error('[cron/weekly-digest] failed', err);
    return NextResponse.json(
      { ok: false, error: 'digest_failed' },
      { status: 500 },
    );
  }
}
