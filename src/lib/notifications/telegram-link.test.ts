import { describe, expect, it } from 'vitest';
import { hashLinkToken, isLinkToken, newLinkToken } from './telegram-link';

describe('Telegram link token', () => {
  it('is 32 characters valid in a deep link, different every time', () => {
    const a = newLinkToken();
    const b = newLinkToken();
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(isLinkToken(a.token)).toBe(true);
    expect(a.token).not.toBe(b.token);
  });

  it('is stored as a stable sha256', () => {
    const { token, hash } = newLinkToken();
    expect(hash).toBe(hashLinkToken(token));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses the old signed format and anything else', () => {
    expect(isLinkToken('0f8b2c1e-1d2a-4c3b-9a8e-7f6d5c4b3a21.abcdefabcdefabcdefabcdef')).toBe(false);
    expect(isLinkToken('short')).toBe(false);
    expect(isLinkToken('a'.repeat(31) + '!')).toBe(false);
  });
});
