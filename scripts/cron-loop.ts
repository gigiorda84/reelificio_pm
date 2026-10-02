// Stand-in for Vercel Cron in development and on staging, where Vercel runs
// no crons (they only fire on the production deployment). Calls each
// /api/cron/<route> with the CRON_SECRET bearer every N minutes.
//
//   pnpm exec tsx scripts/cron-loop.ts                      # task-sweep + standup, every 5 min, localhost:3000
//   pnpm exec tsx scripts/cron-loop.ts --once alerts        # one call to /api/cron/alerts
//   pnpm exec tsx scripts/cron-loop.ts --base https://<preview>.vercel.app --every 5
//
// For a protected Vercel Preview set VERCEL_AUTOMATION_BYPASS_SECRET (Project
// Settings → Deployment Protection → Protection Bypass for Automation).
// The routes task-sweep and standup arrive in S4; until then they answer 404.
import { config } from 'dotenv';

config({ path: '.env.local' });

const DEFAULT_ROUTES = ['task-sweep', 'standup'];
const PRODUCTION_HOSTS = ['reelificio-pm.vercel.app', 'app.reelificio.com'];

type Args = { base: string; everyMinutes: number; once: boolean; routes: string[] };

function parseArgs(argv: string[]): Args {
  const args: Args = {
    base: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
    everyMinutes: 5,
    once: false,
    routes: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base') args.base = argv[++i];
    else if (a === '--every') args.everyMinutes = Number(argv[++i]);
    else if (a === '--once') args.once = true;
    else if (a.startsWith('--')) throw new Error(`Unknown option ${a}`);
    else args.routes.push(a);
  }
  if (args.routes.length === 0) args.routes = DEFAULT_ROUTES;
  if (!Number.isFinite(args.everyMinutes) || args.everyMinutes <= 0) {
    throw new Error('--every must be a positive number of minutes');
  }
  return args;
}

async function callRoute(base: string, route: string, secret: string) {
  const headers: Record<string, string> = { Authorization: `Bearer ${secret}` };
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypass) headers['x-vercel-protection-bypass'] = bypass;

  const started = Date.now();
  const stamp = new Date().toISOString();
  try {
    const res = await fetch(new URL(`/api/cron/${route}`, base), { headers });
    const body = (await res.text()).replace(/\s+/g, ' ').slice(0, 300);
    console.log(`${stamp} ${route} ${res.status} ${Date.now() - started}ms ${body}`);
  } catch (err) {
    console.log(`${stamp} ${route} FAILED ${(err as Error).message}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const host = new URL(args.base).hostname;
  if (PRODUCTION_HOSTS.includes(host)) {
    throw new Error(`${host} is production: there Vercel Cron runs the jobs.`);
  }
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error('CRON_SECRET is not set in .env.local');

  console.log(
    `cron-loop → ${args.base} · ${args.routes.join(', ')}` +
      (args.once ? ' · once' : ` · every ${args.everyMinutes} min (Ctrl+C to stop)`),
  );

  for (;;) {
    for (const route of args.routes) await callRoute(args.base, route, secret);
    if (args.once) return;
    await new Promise((r) => setTimeout(r, args.everyMinutes * 60_000));
  }
}

main().catch((err) => {
  console.error('FAIL:', (err as Error).message);
  process.exit(1);
});
