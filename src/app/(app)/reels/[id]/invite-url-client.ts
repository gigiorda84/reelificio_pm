// Build the public invite URL from the client. Mirrors lib/invites/tokens
// (which is server-only) but uses NEXT_PUBLIC_APP_URL + a window fallback.
export function buildInviteUrlClient(token: string): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL;
  const base =
    fromEnv ??
    (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000');
  return `${base.replace(/\/$/, '')}/invite/${token}`;
}
