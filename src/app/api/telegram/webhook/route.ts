import { timingSafeEqual } from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { handleUpdate, type TelegramUpdate } from '@/lib/telegram/handle';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Telegram calls this with the secret registered by
// scripts/telegram-set-webhook.ts (header X-Telegram-Bot-Api-Secret-Token).
// Updates: message (account linking), callback_query (buttons),
// my_chat_member (the team chat id, logged). Always 200 once authenticated,
// or Telegram would resend the update.
function authorized(req: NextRequest): boolean {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) return false;
  const a = Buffer.from(req.headers.get('x-telegram-bot-api-secret-token') ?? '');
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  let update: TelegramUpdate;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  try {
    await handleUpdate(update);
  } catch (err) {
    console.error('[telegram/webhook] update failed', err);
  }
  return NextResponse.json({ ok: true });
}
