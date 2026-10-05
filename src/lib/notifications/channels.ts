// Task notifications (docs/fase1-plan.md §3): Telegram is the primary
// channel; an email goes out only when Telegram cannot carry the message:
// not linked, switched off for the event, refused for good (403 bot
// blocked, 400 chat not found) or the job's last attempt failed. A 429 or a
// 5xx is retried by the outbox, with no email, so nobody gets both.

export type TaskChannelPrefs = { telegramLinked: boolean; telegramOn: boolean; emailOn: boolean };

export function resolveTaskChannels(p: TaskChannelPrefs): { telegram: boolean; email: boolean } {
  const telegram = p.telegramLinked && p.telegramOn;
  return { telegram, email: !telegram && p.emailOn };
}

export type TelegramFailure = 'permanent' | 'transient';

// After a Telegram failure: fall back to email, or let the outbox retry.
export function afterTelegramFailure(p: {
  failure: TelegramFailure;
  lastAttempt: boolean;
  emailOn: boolean;
}): 'email' | 'retry' | 'give_up' {
  if (p.failure === 'transient' && !p.lastAttempt) return 'retry';
  return p.emailOn ? 'email' : 'give_up';
}

// Telegram Bot API errors: 4xx other than 429 will fail again the same way.
export function telegramFailureKind(status: number): TelegramFailure {
  return status >= 400 && status < 500 && status !== 429 ? 'permanent' : 'transient';
}
