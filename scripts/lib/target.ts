// Which Supabase project a script talks to (docs/fase1-plan.md I1).
//
//   --target staging     (default) loads .env.local
//   --target production  loads .env.production.local, prints the project and
//                        asks to type the project ref before going on
//
// The project ref in the URL must match the target, so a misplaced env file
// stops the script instead of writing to the wrong database. Staging-only
// scripts pass { allowProduction: false } and refuse production outright.
import { createInterface } from 'node:readline/promises';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import WebSocket from 'ws';

// Node 20 has no native WebSocket; @supabase/realtime-js needs one.
(globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket =
  WebSocket as unknown as typeof globalThis.WebSocket;

export type Target = 'staging' | 'production';

export const PROJECT_REFS: Record<Target, string> = {
  staging: 'zrzgxudzetuztleujfri',
  production: 'rbcgtwohcsqjmyjzhlbx',
};

const ENV_FILES: Record<Target, string> = {
  staging: '.env.local',
  production: '.env.production.local',
};

export type Loaded = {
  target: Target;
  ref: string;
  url: string;
  admin: SupabaseClient;
  appUrl: string;
  args: string[]; // argv without --target
};

export async function loadTarget(
  argv: string[],
  opts: { allowProduction: boolean },
): Promise<Loaded> {
  const args = [...argv];
  let target: Target = 'staging';
  const i = args.indexOf('--target');
  if (i >= 0) {
    const value = args[i + 1];
    if (value !== 'staging' && value !== 'production') {
      throw new Error('--target must be staging or production');
    }
    target = value;
    args.splice(i, 2);
  }
  if (target === 'production' && !opts.allowProduction) {
    throw new Error('this script is for staging only');
  }

  config({ path: ENV_FILES[target], override: true, quiet: true });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SECRET_KEY ?? '';
  if (!url || !key) throw new Error(`NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY missing in ${ENV_FILES[target]}`);

  const ref = new URL(url).hostname.split('.')[0];
  if (ref !== PROJECT_REFS[target]) {
    throw new Error(`${ENV_FILES[target]} points at ${ref}, not the ${target} project ${PROJECT_REFS[target]}`);
  }

  const bot = process.env.TELEGRAM_BOT_USERNAME || '(none)';
  console.log(`target: ${target} · project ${ref} · bot @${bot}`);

  if (target === 'production') {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const typed = await rl.question(`PRODUCTION. Type the project ref to continue: `);
    rl.close();
    if (typed.trim() !== ref) throw new Error('confirmation does not match, stopped');
  }

  const admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');
  return { target, ref, url, admin, appUrl, args };
}

// Lowercased, trimmed emails from a one-per-line file; # starts a comment.
export function readEmailList(text: string): Set<string> {
  return new Set(
    text
      .split('\n')
      .map((l) => l.replace(/#.*/, '').trim().toLowerCase())
      .filter(Boolean),
  );
}
