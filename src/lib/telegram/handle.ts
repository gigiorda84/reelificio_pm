import 'server-only';
import { after } from 'next/server';
import { createTranslator } from 'next-intl';
import messages from '@/messages/it.json';
import { drainOutbox } from '@/lib/jobs/drain';
import { sendEmail } from '@/lib/notifications/email';
import {
  answerCallbackQuery,
  editMessageButtons,
  editMessageText,
  sendTelegramMessage,
  type TelegramMessageEntity,
} from '@/lib/notifications/telegram';
import { hashLinkToken, isLinkToken } from '@/lib/notifications/telegram-link';
import { sendBackConfirmButtons, taskButtons, taskLink } from '@/lib/notifications/task-messages';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { DECISION_KINDS, type TaskKind, type TaskStatus } from '@/lib/tasks/constants';
import { parseCallback, type CallbackOp } from './callback';

// Telegram updates (docs/fase1-plan.md D4, §S4). Only private chats count:
// the person is found by the chat id saved when they linked their account,
// and every action goes through task_action_as, where SQL checks again who
// may do what. Buttons that are old or forwarded fail safely ("Già deciso",
// "Non autorizzato", "Testo cambiato").

const t = createTranslator({ locale: 'it', messages, namespace: 'notifications.telegram' });

type TgChat = { id: number; type: string; title?: string };
type TgMessage = { message_id: number; chat: TgChat; text?: string; entities?: TelegramMessageEntity[] };
export type TelegramUpdate = {
  message?: TgMessage;
  callback_query?: { id: string; from: { id: number }; data?: string; message?: TgMessage };
  my_chat_member?: { chat: TgChat; new_chat_member?: { status?: string } };
};

function log(fields: Record<string, unknown>) {
  console.log(JSON.stringify({ evt: 'telegram', ...fields }));
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || 'http://localhost:3000';
}

export async function handleUpdate(update: TelegramUpdate): Promise<void> {
  if (update.callback_query) return handleCallback(update.callback_query);
  if (update.my_chat_member) {
    // The bot added to a group: the id to put in TELEGRAM_TEAM_CHAT_ID.
    const { chat, new_chat_member } = update.my_chat_member;
    log({ kind: 'my_chat_member', chat_id: chat.id, chat_type: chat.type, title: chat.title, status: new_chat_member?.status });
    return;
  }
  if (update.message) return handleMessage(update.message);
}

// /start <token> (deep link from /settings) or /link <token>.
async function handleMessage(msg: TgMessage): Promise<void> {
  if (msg.chat.type !== 'private') return;
  const chatId = String(msg.chat.id);
  const text = (msg.text ?? '').trim();
  const match = text.match(/^\/(?:start|link)(?:@\w+)?\s+(\S+)/i);
  if (!match) {
    if (/^\/start\b/i.test(text)) await sendTelegramMessage(chatId, t('help'));
    return;
  }
  const token = match[1];
  const admin = getSupabaseAdminClient();
  const { data, error } = isLinkToken(token)
    ? await admin.rpc('link_telegram', { p_token_hash: hashLinkToken(token), p_chat_id: chatId })
    : { data: { code: 'invalid' }, error: null };
  if (error) {
    log({ kind: 'link', level: 'error', error: error.message });
    await sendTelegramMessage(chatId, t('error'));
    return;
  }
  const result = data as { code: 'ok' | 'invalid' | 'chat_taken'; user_id?: string };
  log({ kind: 'link', code: result.code, user_id: result.user_id });
  if (result.code === 'chat_taken') {
    await sendTelegramMessage(chatId, t('chatTaken'));
    return;
  }
  if (result.code !== 'ok') {
    await sendTelegramMessage(chatId, t('linkInvalid'));
    return;
  }
  await sendTelegramMessage(chatId, t('linked'));
  // Tell the owner of the account by email: a link they did not make shows.
  const { data: profile } = await admin.from('profiles').select('email').eq('id', result.user_id!).maybeSingle();
  if (profile?.email) {
    await sendEmail({
      to: profile.email,
      subject: t('linkedEmail.subject'),
      text: t('linkedEmail.body'),
      html: `<p>${t('linkedEmail.body')}</p>`,
    });
  }
}

const OP_FOR: Partial<Record<CallbackOp, 'accept' | 'decline' | 'approve' | 'send_back'>> = {
  acc: 'accept',
  dec: 'decline',
  apr: 'approve',
  rimc: 'send_back',
};

const ERROR_CODES = [
  'invalid_state',
  'not_authorized',
  'stale',
  'task_not_found',
  'dod_incomplete',
  'script_missing',
  'invalid_input',
] as const;

async function handleCallback(cq: NonNullable<TelegramUpdate['callback_query']>): Promise<void> {
  const started = Date.now();
  const msg = cq.message;
  const parsed = cq.data ? parseCallback(cq.data) : null;
  if (!msg || msg.chat.type !== 'private' || !parsed) {
    await answerCallbackQuery(cq.id, t('badButton'));
    return;
  }
  const chatId = String(msg.chat.id);
  const admin = getSupabaseAdminClient();
  const { data: actor } = await admin
    .from('profiles')
    .select('id')
    .eq('telegram_chat_id', String(cq.from.id))
    .is('deactivated_at', null)
    .maybeSingle();
  if (!actor) {
    await answerCallbackQuery(cq.id, t('notLinked'));
    return;
  }

  // Rimanda (first tap) and Annulla only swap the buttons.
  if (parsed.op === 'rim' || parsed.op === 'ann') {
    const ctx = await loadTask(admin, parsed.taskId, parsed.rev);
    if (!ctx || !ctx.open) {
      await finish(cq.id, chatId, msg, t('outcome.invalid_state'));
      return;
    }
    await editMessageButtons(
      chatId,
      msg.message_id,
      parsed.op === 'rim'
        ? sendBackConfirmButtons(ctx.task, parsed.rev)
        : ctx.buttons,
    );
    await answerCallbackQuery(cq.id);
    return;
  }

  const op = OP_FOR[parsed.op]!;
  const payload: Record<string, unknown> = {};
  if (parsed.rev !== null) payload.rev = parsed.rev;
  if (op === 'send_back') payload.to = 'animation';
  const { data: code, error } = await admin.rpc('task_action_as', {
    p_actor: actor.id,
    p_task_id: parsed.taskId,
    p_op: op,
    p_note: null,
    p_payload: Object.keys(payload).length ? payload : null,
    p_channel: 'telegram',
  });
  const result = error ? 'unknown' : (code as string);
  log({ kind: 'callback', op, task_id: parsed.taskId, actor: actor.id, code: result, ms: Date.now() - started, error: error?.message });

  if (result === 'ok') {
    await finish(cq.id, chatId, msg, t(`outcome.${parsed.op as 'acc' | 'dec' | 'apr' | 'rimc'}`));
    // What the action queued (the next person's task) goes out now.
    after(() => drainOutbox({ limit: 10, deadlineMs: 8_000 }).then(() => undefined));
    return;
  }
  const known = (ERROR_CODES as readonly string[]).includes(result) ? result : 'unknown';
  await finish(cq.id, chatId, msg, t(`outcome.${known as (typeof ERROR_CODES)[number] | 'unknown'}`));
}

// Answers the tap and writes the outcome under the message, buttons gone
// (the formatting stays: the outcome is appended, offsets do not move).
async function finish(callbackId: string, chatId: string, msg: TgMessage, outcome: string) {
  await answerCallbackQuery(callbackId, outcome);
  if (msg.text) {
    await editMessageText(chatId, msg.message_id, `${msg.text}\n\n${outcome}`, { entities: msg.entities });
  }
}

// The task with the buttons it had (for "Annulla"), Approva on the revision
// the message showed, not the current one.
async function loadTask(admin: ReturnType<typeof getSupabaseAdminClient>, taskId: string, shownRev: number | null) {
  const { data: task } = await admin
    .from('tasks')
    .select('id, kind, status, reel_id, reels(id, code, title, track, script_rev, audio_drive_url, video_drive_url)')
    .eq('id', taskId)
    .maybeSingle();
  if (!task) return null;
  const t0 = task as unknown as {
    id: string;
    kind: TaskKind;
    status: TaskStatus;
    reels: { id: string; code: string; title: string; track: string; script_rev: number; audio_drive_url: string | null; video_drive_url: string | null };
  };
  const reel = t0.reels;
  const messageTask = { id: t0.id, kind: t0.kind, status: t0.status, dueAt: null };
  return {
    task: messageTask,
    open: ['unassigned', 'assigned', 'in_progress'].includes(t0.status),
    buttons: taskButtons({
      task: messageTask,
      reel: {
        id: reel.id,
        code: reel.code,
        title: reel.title,
        express: reel.track === 'express',
        scriptRev: shownRev ?? reel.script_rev,
        hook: null,
        corpo: null,
        chiusura: null,
        cta: null,
        rawContent: null,
        audioUrl: reel.audio_drive_url,
        videoUrl: reel.video_drive_url,
      },
      role: DECISION_KINDS.includes(t0.kind) ? 'approver' : 'assignee',
      link: taskLink(appUrl(), reel.id, t0.id),
      // Only a message that showed the whole script had Approva.
      scriptShownInFull: true,
    }),
  };
}
