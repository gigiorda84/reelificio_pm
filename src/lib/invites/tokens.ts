import 'server-only';
import { randomBytes } from 'node:crypto';

// 32 bytes -> 43 url-safe chars. Plenty of entropy; unguessable.
export function generateInviteToken(): string {
  return randomBytes(32).toString('base64url');
}

export function buildInviteUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  return `${base.replace(/\/$/, '')}/invite/${token}`;
}
