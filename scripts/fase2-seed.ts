// Fixture for the Fase 2 sandbox (docs/fase2-plan.md S0, §7.3). Sandbox
// only; safe to run again.
//
//   pnpm exec tsx scripts/fase2-seed.ts [--as hello@reelificio.com]
//
// 1. The admin (--as): created in auth if missing, marked internal and admin.
// 2. The Fase 1 fixture, by running scripts/fase1-seed-staging.ts against the
//    sandbox: Pagina Test (TT), internal and external test users as
//    plus-aliases of the admin's mailbox, approval group, RACI, a batch.
// 3. From S2 on: the Porcino & Papaya bible from
//    tests/fixtures/bible-porcino-papaya.json (no personal data).
//
// No email is sent: users are created confirmed, and the magic link is
// requested from the login page when needed.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { loadTarget } from './lib/target';

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--target')) throw new Error('fase2-seed always targets the sandbox');
  const { admin, args } = await loadTarget(['--target', 'sandbox', ...argv], { allowProduction: false });
  const i = args.indexOf('--as');
  const asEmail = (i >= 0 ? args[i + 1] : 'hello@reelificio.com')?.toLowerCase();
  if (!asEmail) throw new Error('--as needs an email');

  // 1. Admin.
  const found = await admin.from('profiles').select('id, is_admin').eq('email', asEmail).maybeSingle();
  if (found.error) throw new Error(`admin lookup: ${found.error.message}`);
  let id = found.data?.id as string | undefined;
  if (!id) {
    const { data, error } = await admin.auth.admin.createUser({
      email: asEmail,
      email_confirm: true,
      app_metadata: { account_type: 'internal' },
      user_metadata: { full_name: 'Admin Sandbox' },
    });
    if (error || !data.user) throw new Error(`${asEmail}: ${error?.message}`);
    id = data.user.id;
  }
  const upd = await admin
    .from('profiles')
    .update({ is_admin: true, account_type: 'internal', external_kind: null })
    .eq('id', id)
    .select('id');
  if (upd.error || !upd.data?.length) throw new Error(`admin flag: ${upd.error?.message ?? 'no row'}`);
  console.log(`admin: ${asEmail} ${id}`);

  // 2. Fase 1 fixture on the sandbox.
  execFileSync(
    process.execPath,
    [
      join(__dirname, '../node_modules/tsx/dist/cli.mjs'),
      join(__dirname, 'fase1-seed-staging.ts'),
      '--target',
      'sandbox',
      '--as',
      asEmail,
    ],
    { stdio: 'inherit' },
  );

  console.log('OK: sandbox seeded');
}

main().catch((err) => {
  console.error('FAIL:', (err as Error).message);
  process.exit(1);
});
