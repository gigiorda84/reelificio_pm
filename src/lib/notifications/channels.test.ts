import { describe, expect, it } from 'vitest';
import { afterTelegramFailure, resolveTaskChannels, telegramFailureKind } from './channels';

describe('resolveTaskChannels', () => {
  it('Telegram linked and on: Telegram only', () => {
    expect(resolveTaskChannels({ telegramLinked: true, telegramOn: true, emailOn: true })).toEqual({ telegram: true, email: false });
  });

  it('not linked or switched off: email, if allowed', () => {
    expect(resolveTaskChannels({ telegramLinked: false, telegramOn: true, emailOn: true })).toEqual({ telegram: false, email: true });
    expect(resolveTaskChannels({ telegramLinked: true, telegramOn: false, emailOn: true })).toEqual({ telegram: false, email: true });
    expect(resolveTaskChannels({ telegramLinked: false, telegramOn: true, emailOn: false })).toEqual({ telegram: false, email: false });
  });
});

describe('afterTelegramFailure', () => {
  it('a permanent error (403, chat not found) falls back to email', () => {
    expect(afterTelegramFailure({ failure: telegramFailureKind(403), lastAttempt: false, emailOn: true })).toBe('email');
    expect(afterTelegramFailure({ failure: telegramFailureKind(400), lastAttempt: false, emailOn: true })).toBe('email');
  });

  it('429 and 5xx are retried, with no email, until the last attempt', () => {
    expect(afterTelegramFailure({ failure: telegramFailureKind(429), lastAttempt: false, emailOn: true })).toBe('retry');
    expect(afterTelegramFailure({ failure: telegramFailureKind(502), lastAttempt: false, emailOn: true })).toBe('retry');
    expect(afterTelegramFailure({ failure: telegramFailureKind(502), lastAttempt: true, emailOn: true })).toBe('email');
  });

  it('with email off there is nothing else to try', () => {
    expect(afterTelegramFailure({ failure: 'permanent', lastAttempt: false, emailOn: false })).toBe('give_up');
  });
});
