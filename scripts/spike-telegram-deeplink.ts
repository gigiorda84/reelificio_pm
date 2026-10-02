// S0 spike (D4): does `t.me/<bot>?start=<32 chars [A-Za-z0-9_-]>` deliver the
// token intact? The Fase 1 link token is 32 random base64url characters.
//
//   pnpm exec tsx scripts/spike-telegram-deeplink.ts
//
// Uses the STAGING bot from .env.local (TELEGRAM_BOT_TOKEN) and refuses the
// production bot. Without a webhook it long-polls getUpdates and waits for
// "/start <token>"; with a webhook set it prints the link and the update must
// be checked in the webhook logs instead (getUpdates is disabled then).
import { randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import { config, parse } from 'dotenv';

config({ path: '.env.local', quiet: true });

type Update = {
  update_id: number;
  message?: { text?: string; chat: { id: number; type: string }; from?: { id: number } };
};

async function tg<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const body = (await res.json()) as { ok: boolean; result: T; description?: string };
  if (!body.ok) throw new Error(`${method}: ${body.description}`);
  return body.result;
}

function productionBotToken(): string | undefined {
  try {
    return parse(readFileSync('.env.production.local')).TELEGRAM_BOT_TOKEN || undefined;
  } catch {
    return undefined;
  }
}

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN (staging bot) is empty in .env.local');
  if (token === productionBotToken()) throw new Error('.env.local has the production bot token');

  const me = await tg<{ username: string }>('getMe');
  const hook = await tg<{ url: string }>('getWebhookInfo');

  const linkToken = randomBytes(24).toString('base64url'); // 32 chars
  const link = `https://t.me/${me.username}?start=${linkToken}`;
  console.log(`Bot: @${me.username}\nToken (${linkToken.length} chars): ${linkToken}\nLink: ${link}\n`);

  if (hook.url) {
    console.log(`Webhook set (${new URL(hook.url).host}): open the link, press Start, then`);
    console.log(`look for "/start ${linkToken}" in that deployment's webhook logs.`);
    return;
  }

  console.log('Open the link on the phone and press Start. Waiting up to 5 minutes…');
  let offset = 0;
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    const updates = await tg<Update[]>('getUpdates', {
      offset,
      timeout: 25,
      allowed_updates: ['message'],
    });
    for (const u of updates) {
      offset = u.update_id + 1;
      const text = u.message?.text ?? '';
      if (!text.startsWith('/start')) continue;
      const received = text.slice('/start'.length).trim();
      const intact = received === linkToken;
      console.log(`Received: "${text}"`);
      console.log(`chat.type=${u.message?.chat.type} from.id=${u.message?.from?.id}`);
      console.log(intact ? 'PASS: token intact' : `FAIL: expected ${linkToken}`);
      await tg('sendMessage', {
        chat_id: u.message?.chat.id,
        text: intact ? 'Spike S0: deep link ricevuto intatto ✅' : 'Spike S0: token alterato ❌',
      });
      await tg('getUpdates', { offset, timeout: 0 }); // acknowledge
      process.exit(intact ? 0 : 2);
    }
  }
  throw new Error('No /start received within 5 minutes');
}

main().catch((err) => {
  console.error('FAIL:', (err as Error).message);
  process.exit(1);
});
