import { NextResponse, type NextRequest } from 'next/server';
import { sendDailyReminders } from '@/lib/daily-updates/reminder';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
