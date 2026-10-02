// External collaborator accounts from a reviewed CSV (docs/fase1-plan.md
// §S1; release step 6b; replaces the /collaboratori page in R1).
//
//   pnpm exec tsx scripts/fase1-collaborators.ts [--target staging|production] --as <admin email> \
//     import [--csv <path>] [--dry-run] [--convert-existing]
//   … --as <admin email> send-links [--csv <path>] [--dry-run]
//   … --as <admin email> offboard <email> [--dry-run]
//
// CSV (default supabase/backups/fase1/collaborators.csv, not in git):
//   email,full_name,external_kind,drive_email     external_kind: dubber|animator|validator
//
// import   creates the auth users as external (or updates existing externals)
//          and sets kind, name and Drive email. Stops before writing anything
//          if a row is an internal profile, unless that profile was reviewed
//          as actually external (--convert-existing, I11), or an admin.
// send-links  sends each collaborator the login email (Supabase SMTP, the
//          "Magic Link" template; it needs the token_hash template of I15).
// offboard deactivates the profile, clears it from the pages and bans the user.
import { readFileSync } from 'node:fs';
import {
  applyImport,
  loadExistingProfiles,
  offboardCollaborator,
  parseCollaboratorsCsv,
  planImport,
  type CollaboratorRow,
} from '../src/lib/collaborators/admin';
import { loadTarget } from './lib/target';

const DEFAULT_CSV = 'supabase/backups/fase1/collaborators.csv';

function takeFlag(args: string[], name: string): boolean {
  const i = args.indexOf(name);
  if (i < 0) return false;
  args.splice(i, 1);
  return true;
}

function takeValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} needs a value`);
  args.splice(i, 2);
  return value;
}

function readCsv(path: string): CollaboratorRow[] {
  const { rows, errors } = parseCollaboratorsCsv(readFileSync(path, 'utf8'));
  if (errors.length) throw new Error(`${path}:\n  ${errors.join('\n  ')}`);
  console.log(`${path}: ${rows.length} collaborators`);
  return rows;
}

async function main() {
  const { admin, appUrl, args } = await loadTarget(process.argv.slice(2), { allowProduction: true });
  const actorEmail = takeValue(args, '--as')?.toLowerCase();
  const csvPath = takeValue(args, '--csv') ?? DEFAULT_CSV;
  const dryRun = takeFlag(args, '--dry-run');
  const convertExisting = takeFlag(args, '--convert-existing');
  const [command, ...rest] = args;
  if (!actorEmail) throw new Error('--as <admin email> is required');

  const { data: actor, error: actorErr } = await admin
    .from('profiles')
    .select('id, is_admin')
    .eq('email', actorEmail)
    .maybeSingle();
  if (actorErr) throw new Error(actorErr.message);
  if (!actor?.is_admin) throw new Error(`${actorEmail} is not an admin`);
  if (dryRun) console.log('DRY RUN: nothing will be written');

  if (command === 'import') {
    const rows = readCsv(csvPath);
    const existing = await loadExistingProfiles(admin, rows.map((r) => r.email));
    const plan = planImport(rows, existing, { convertExisting });
    for (const p of plan) {
      const why = p.action === 'refuse' ? ` — ${p.reason}` : '';
      console.log(`  ${p.action.padEnd(7)} ${p.row.email} (${p.row.external_kind})${why}`);
    }
    if (plan.some((p) => p.action === 'refuse')) {
      throw new Error('refused rows: fix the CSV or the review, nothing was written');
    }
    if (dryRun) return;

    const ids = await applyImport(admin, actor.id, plan);
    const { data: check, error } = await admin
      .from('profiles')
      .select('email, account_type, external_kind')
      .in('id', [...ids.values()]);
    if (error) throw new Error(error.message);
    const wrong = (check ?? []).filter(
      (p) => p.account_type !== 'external' ||
        p.external_kind !== rows.find((r) => r.email === p.email.toLowerCase())?.external_kind,
    );
    if (wrong.length || (check ?? []).length !== rows.length) {
      throw new Error(`verification failed: ${JSON.stringify(wrong)}`);
    }
    console.log(`OK: ${rows.length} external accounts ready (no email sent; use send-links)`);
    return;
  }

  if (command === 'send-links') {
    const rows = readCsv(csvPath);
    const existing = await loadExistingProfiles(admin, rows.map((r) => r.email));
    const missing = rows.filter((r) => existing.get(r.email)?.account_type !== 'external');
    if (missing.length) {
      throw new Error(`not external accounts (run import first): ${missing.map((r) => r.email).join(', ')}`);
    }
    for (const row of rows) {
      console.log(`  ${dryRun ? 'would send' : 'send'} ${row.email}`);
      if (dryRun) continue;
      const { error } = await admin.auth.signInWithOtp({
        email: row.email,
        options: { shouldCreateUser: false, emailRedirectTo: `${appUrl}/auth/callback` },
      });
      if (error) console.error(`    failed: ${error.message}`);
    }
    return;
  }

  if (command === 'offboard') {
    const email = rest[0]?.toLowerCase();
    if (!email) throw new Error('offboard <email>');
    const { data: target, error } = await admin
      .from('profiles')
      .select('id, account_type, deactivated_at')
      .eq('email', email)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!target) throw new Error(`${email}: no profile`);
    console.log(`  offboard ${email} (${target.account_type}${target.deactivated_at ? ', already deactivated' : ''})`);
    if (dryRun) return;
    await offboardCollaborator(admin, actor.id, target.id);
    console.log('OK: deactivated, removed from pages, banned');
    return;
  }

  throw new Error('command must be import, send-links or offboard (see the header)');
}

main().catch((err) => {
  console.error('FAIL:', (err as Error).message);
  process.exit(1);
});
