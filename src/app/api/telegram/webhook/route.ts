import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { sendTelegramMessage } from '@/lib/notifications/telegram';
import { verifyTelegramLinkToken } from '@/lib/notifications/telegram-link';

type TelegramUpdate = {
  message?: {
    chat?: { id?: number };
    text?: string;
  };
};

export async function POST(req: NextRequest) {
  const headerSecret = req.headers.get('x-telegram-bot-api-secret-token');
  if (
    !process.env.TELEGRAM_WEBHOOK_SECRET ||
    headerSecret !== process.env.TELEGRAM_WEBHOOK_SECRET
  ) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const chatId = update.message?.chat?.id;
  const text = (update.message?.text ?? '').trim();
  if (!chatId || !text) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const linkMatch = text.match(/^\/(?:start|link)(?:@\w+)?\s+(\S+)/i);
  if (linkMatch) {
    const token = linkMatch[1];
    const userId = verifyTelegramLinkToken(token);
    if (!userId) {
      await sendTelegramMessage(
        String(chatId),
        '❌ Codice non valido. Apri Impostazioni nell\'app e usa il pulsante "Collega Telegram" per generarne uno nuovo.',
      );
      return NextResponse.json({ ok: true });
    }
    let supabase;
    try {
      supabase = getSupabaseAdminClient();
    } catch (e) {
      console.error('[telegram/webhook] admin client init failed:', e);
      await sendTelegramMessage(String(chatId), '⚠️ Errore tecnico, riprova più tardi.');
      return NextResponse.json({ ok: false, error: 'admin_init' }, { status: 500 });
    }

    const { data, error, count } = await supabase
      .from('profiles')
      .update({ telegram_chat_id: String(chatId) })
      .eq('id', userId)
      .select('id', { count: 'exact' });
    if (error) {
      console.error('[telegram/webhook] profiles.update failed:', {
        message: error.message,
        code: error.code,
        details: error.details,
        userId,
      });
      await sendTelegramMessage(String(chatId), '⚠️ Errore tecnico, riprova più tardi.');
      return NextResponse.json({ ok: false, error: 'update_failed' }, { status: 500 });
    }
    if (!data || data.length === 0) {
      console.error('[telegram/webhook] no profile row matched userId', { userId, count });
      await sendTelegramMessage(
        String(chatId),
        '⚠️ Profilo non trovato. Effettua almeno un login nell\'app prima di collegare Telegram.',
      );
      return NextResponse.json({ ok: false, error: 'profile_not_found' }, { status: 200 });
    }
    await sendTelegramMessage(
      String(chatId),
      '✅ Account collegato. Riceverai qui le notifiche di Reellificio PM.',
    );
    return NextResponse.json({ ok: true });
  }

  if (/^\/start\b/i.test(text)) {
    await sendTelegramMessage(
      String(chatId),
      'Ciao! Apri Impostazioni nell\'app, clicca su "Collega Telegram" e copia qui il comando che ti viene mostrato.',
    );
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true });
}
