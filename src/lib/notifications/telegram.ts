import 'server-only';
import { telegramFailureKind, type TelegramFailure } from './channels';

// Telegram Bot API calls used by notifications, the stand-up and the
// webhook. Errors carry their kind (channels.ts): permanent ones fall back to
// email, transient ones are retried by the outbox.

export type InlineButton =
  | { text: string; callback_data: string }
  | { text: string; url: string };
export type InlineKeyboard = InlineButton[][];

export type TelegramMessageEntity = { type: string; offset: number; length: number; url?: string };

export type TelegramSendResult =
  | { ok: true; messageId: number | null }
  | { ok: false; status: number; error: string; kind: TelegramFailure };

async function call(method: string, body: Record<string, unknown>): Promise<TelegramSendResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, status: 0, error: 'telegram_not_configured', kind: 'permanent' };
  let res: Response;
  try {
    // A hung connection must not eat the route's 60 s: a timeout is a
    // transient error, retried by the outbox.
    res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
    });
  } catch (err) {
    return { ok: false, status: 0, error: `telegram_network: ${String(err).slice(0, 200)}`, kind: 'transient' };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return {
      ok: false,
      status: res.status,
      error: `telegram_${res.status}: ${text.slice(0, 200)}`,
      kind: telegramFailureKind(res.status),
    };
  }
  const json = (await res.json().catch(() => null)) as { result?: { message_id?: number } } | null;
  return { ok: true, messageId: json?.result?.message_id ?? null };
}

export async function sendTelegramMessage(
  chatId: string,
  text: string,
  opts: { buttons?: InlineKeyboard; silent?: boolean } = {},
): Promise<TelegramSendResult> {
  return call('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...(opts.silent ? { disable_notification: true } : {}),
    ...(opts.buttons ? { reply_markup: { inline_keyboard: opts.buttons } } : {}),
  });
}

export async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<TelegramSendResult> {
  return call('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    ...(text ? { text: text.slice(0, 200) } : {}),
  });
}

// Replaces a message's text, keeping its formatting (entities) when the new
// text extends the old one. No buttons = keyboard removed.
export async function editMessageText(
  chatId: string,
  messageId: number,
  text: string,
  opts: { entities?: TelegramMessageEntity[]; buttons?: InlineKeyboard } = {},
): Promise<TelegramSendResult> {
  return call('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    disable_web_page_preview: true,
    ...(opts.entities ? { entities: opts.entities } : {}),
    reply_markup: { inline_keyboard: opts.buttons ?? [] },
  });
}

export async function editMessageButtons(
  chatId: string,
  messageId: number,
  buttons: InlineKeyboard,
): Promise<TelegramSendResult> {
  return call('editMessageReplyMarkup', {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: buttons },
  });
}
