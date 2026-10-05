import { createHash, randomBytes } from 'crypto';

// Telegram account linking (docs/fase1-plan.md D4): an opaque one-time token
// of 32 characters [A-Za-z0-9_-] (valid in a t.me/<bot>?start= deep link),
// stored only as its sha256 in telegram_link_tokens, valid 15 minutes.
// public.link_telegram() consumes it.

export const LINK_TOKEN_TTL_MS = 15 * 60 * 1000;

const TOKEN = /^[A-Za-z0-9_-]{32}$/;

export function hashLinkToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newLinkToken(): { token: string; hash: string } {
  const token = randomBytes(24).toString('base64url');
  return { token, hash: hashLinkToken(token) };
}

export function isLinkToken(value: string): boolean {
  return TOKEN.test(value);
}
