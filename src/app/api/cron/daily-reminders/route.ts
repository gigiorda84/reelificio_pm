import { NextResponse, type NextRequest } from 'next/server';
import { sendDailyReminders } from '@/lib/daily-updates/reminder';
import { isAuthorizedCronRequest } from '@/lib/auth/cron';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  try {
    const report = await sendDailyReminders();
    return NextResponse.json({ ok: true, ...report });
  } catch (err) {
    console.error('[cron/daily-reminders] failed', err);
    return NextResponse.json(
      { ok: false, error: 'reminder_failed' },
      { status: 500 },
    );
  }
}
