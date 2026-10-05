// Registers the Telegram webhook (docs/fase1-plan.md §S4, release step 6c)
// and checks it with getWebhookInfo. Without callback_query among the
// allowed updates the inline buttons would never reach the app.
//
//   pnpm exec tsx scripts/telegram-set-webhook.ts --bot <username>                       # NEXT_PUBLIC_APP_URL
//   pnpm exec tsx scripts/telegram-set-webhook.ts --bot <username> --url https://<tunnel>
//   pnpm exec tsx scripts/telegram-set-webhook.ts --target production --bot <username>  # asks to type the project ref
//   pnpm exec tsx scripts/telegram-set-webhook.ts --info                                 # read only
//
// The secret is the one route.ts checks (TELEGRAM_WEBHOOK_SECRET); the bot
// token and the secret come from the target's env file. A bot has a single
// webhook: --bot must name the bot the token belongs to (checked with
// getMe), so the production bot is never pointed at staging by mistake.
import { loadTarget } from './lib/target';

const ALLOWED_UPDATES = ['message', 'callback_query', 'my_chat_member'];

type WebhookInfo = { url: string; allowed_updates?: string[]; pending_update_count: number; last_error_message?: string };

async function api<T>(token: string, method: string, body?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const json = (await res.json()) as { ok: boolean; result: T; description?: string };
  if (!json.ok) throw new Error(`${method}: ${json.description ?? res.status}`);
  return json.result;
}

async function main() {
  const { args, appUrl } = await loadTarget(process.argv.slice(2), { allowProduction: true });
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!token || !secret) throw new Error('TELEGRAM_BOT_TOKEN or TELEGRAM_WEBHOOK_SECRET missing');

  const i = args.indexOf('--url');
  const base = (i >= 0 ? args[i + 1] : appUrl).replace(/\/$/, '');
  const url = `${base}/api/telegram/webhook`;

  const me = await api<{ username: string }>(token, 'getMe');
  console.log(`bot: @${me.username}`);

  if (!args.includes('--info')) {
    const b = args.indexOf('--bot');
    const named = (b >= 0 ? args[b + 1] : '').replace(/^@/, '');
    if (named !== me.username) {
      throw new Error(`the token belongs to @${me.username}: pass --bot ${me.username} to confirm`);
    }
    if (!url.startsWith('https://')) throw new Error(`Telegram needs an https URL, got ${url}`);
    await api(token, 'setWebhook', { url, secret_token: secret, allowed_updates: ALLOWED_UPDATES });
    console.log(`setWebhook: ${url}`);
  }

  const info = await api<WebhookInfo>(token, 'getWebhookInfo');
  console.log(JSON.stringify(info, null, 2));
  if (args.includes('--info')) return;
  const missing = ALLOWED_UPDATES.filter((u) => !(info.allowed_updates ?? []).includes(u));
  if (info.url !== url || missing.length) {
    throw new Error(`webhook not as expected: url ${info.url}, missing updates ${missing.join(', ') || 'none'}`);
  }
  console.log('OK: webhook registered with message, callback_query, my_chat_member');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
