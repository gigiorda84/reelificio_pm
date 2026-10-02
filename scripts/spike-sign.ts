// S0 spike: print signed links to the spike pages for any deployment (a
// Vercel Preview, the LAN dev server), valid 24 h, openable with no session.
//
//   pnpm exec tsx scripts/spike-sign.ts <baseUrl> upload <folderId>
//   pnpm exec tsx scripts/spike-sign.ts <baseUrl> media <fileId> [<fileId>…]
//   pnpm exec tsx scripts/spike-sign.ts <baseUrl> sentry test     # server test error
//
// With VERCEL_AUTOMATION_BYPASS_SECRET set (Vercel → Project Settings →
// Deployment Protection → Protection Bypass for Automation), the links also
// pass a protected Preview and set the bypass cookie for the page's requests.
import { config } from 'dotenv';
import { signSpike, type SpikePurpose } from '../src/lib/spike/sign';

config({ path: '.env.local', quiet: true });

function main() {
  const [base, purpose, ...ids] = process.argv.slice(2);
  if (!base || !['upload', 'media', 'sentry'].includes(purpose) || ids.length === 0) {
    throw new Error('Usage: spike-sign.ts <baseUrl> upload|media|sentry <id> [<id>…]');
  }
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  for (const id of ids) {
    const path = purpose === 'sentry' ? '/api/spike/sentry' : `/api/spike/${purpose}/${id}`;
    const url = new URL(`${path}?${signSpike(purpose as SpikePurpose, id)}`, base);
    if (bypass) {
      url.searchParams.set('x-vercel-protection-bypass', bypass);
      url.searchParams.set('x-vercel-set-bypass-cookie', 'true');
    }
    console.log(url.toString());
  }
}

try {
  main();
} catch (err) {
  console.error('FAIL:', (err as Error).message);
  process.exit(1);
}
