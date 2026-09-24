import { NextResponse, type NextRequest } from 'next/server';
import { sendWeeklyDigest } from '@/lib/digest/weekly';
import { isAuthorizedCronRequest } from '@/lib/auth/cron';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
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
