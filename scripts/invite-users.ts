// Pre-provision an INTERNAL user via the Supabase Admin API.
//
// Usage:
//   pnpm exec tsx scripts/invite-users.ts [--target staging|production] [--admin] [--no-link] \
//     <email> "<full name>"
//
// Since Fase 1 a new profile is external unless created as internal, so:
// - the email must be on the reviewed internal allowlist
//   (supabase/backups/fase1/internal-emails.txt, one per line, not in git);
// - the auth user is created with app_metadata.account_type = 'internal',
//   and the profile is set internal explicitly too (also for existing
//   users), since GoTrue may write app_metadata after the profile insert.
// External collaborators go through scripts/fase1-collaborators.ts instead.
//
// Steps: createUser (or find the existing user) → profile internal, name,
// admin flag if --admin (never removed) → magic link printed unless --no-link.
// During the R1 account freeze (dump 0a → step 4) do not run this against
// production.
import { readFileSync } from 'node:fs';
import { loadTarget, readEmailList } from './lib/target';

const ALLOWLIST = 'supabase/backups/fase1/internal-emails.txt';

async function main() {
  const { admin, appUrl, args } = await loadTarget(process.argv.slice(2), { allowProduction: true });
  const makeAdmin = args.includes('--admin');
  const noLink = args.includes('--no-link');
  const [rawEmail, fullName] = args.filter((a) => !a.startsWith('--'));
  const email = rawEmail?.trim().toLowerCase();
  if (!email || !fullName) throw new Error('usage: invite-users.ts [--target …] [--admin] [--no-link] <email> "<full name>"');

  let allowlist: Set<string>;
  try {
    allowlist = readEmailList(readFileSync(ALLOWLIST, 'utf8'));
  } catch {
    throw new Error(`${ALLOWLIST} not found: it lists every internal email`);
  }
  if (!allowlist.has(email)) throw new Error(`${email} is not on the internal allowlist (${ALLOWLIST})`);

  console.log(`→ ${email} (${fullName})`);
  let userId: string;
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: { account_type: 'internal' },
    user_metadata: { full_name: fullName },
  });
  if (createErr) {
    if (!createErr.message.toLowerCase().includes('already')) throw createErr;
    const { data: existing, error } = await admin
      .from('profiles')
      .select('id')
      .eq('email', email)
      .maybeSingle();
    if (error || !existing) throw new Error(`user exists but no profile found for ${email}`);
    userId = existing.id;
    console.log('  · already exists:', userId);
  } else {
    userId = created.user!.id;
    console.log('  · created auth user:', userId);
  }

  const update: Record<string, unknown> = {
    full_name: fullName,
    account_type: 'internal',
    external_kind: null,
  };
  if (makeAdmin) update.is_admin = true;
  const { data: updated, error: profileErr } = await admin
    .from('profiles')
    .update(update)
    .eq('id', userId)
    .select('account_type, is_admin');
  if (profileErr || !updated?.length) throw new Error(`profile update failed: ${profileErr?.message ?? 'no row'}`);
  console.log(`  · profile: ${updated[0].account_type}${updated[0].is_admin ? ', admin' : ''}`);

  if (noLink) return;
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo: `${appUrl}/auth/callback` },
  });
  if (linkErr) console.warn('  · magic link warning:', linkErr.message);
  else if (link?.properties?.action_link) {
    console.log('  · magic link (deliver privately):');
    console.log('   ', link.properties.action_link);
  }
}

main().catch((err) => {
  console.error('FAIL:', (err as Error).message);
  process.exit(1);
});
