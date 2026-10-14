// Migrates the Fase 2 sandbox (docs/fase2-plan.md D-A, DB1) through the
// Supabase Management API: from this Mac the pooler port is blocked, and the
// API runs each request as one transaction (one file = one request).
//
//   pnpm exec tsx scripts/fase2-sandbox-migrate.ts            # apply what is pending
//   pnpm exec tsx scripts/fase2-sandbox-migrate.ts --dry-run  # list it only
//   pnpm exec tsx scripts/fase2-sandbox-migrate.ts --reapply-changed
//
// Order, as in scripts/db-check/run.sh: supabase/migrations/*, then the R1
// contract from supabase/rollback/ (until it becomes a migration), then
// supabase/fase2/*. Migrations are recorded in
// supabase_migrations.schema_migrations like `supabase db push` does; the
// contract and the Fase 2 files in supabase_migrations.fase2_files with
// their md5. A Fase 2 file edited after it was applied stops the script,
// unless --reapply-changed (fine for the re-runnable ones).
//
// Refuses any project but the sandbox: the ref comes from .env.fase2.local
// and must be PROJECT_REFS.sandbox.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { config } from 'dotenv';
import { ENV_FILES, PROJECT_REFS } from './lib/target';

const ROOT = join(__dirname, '..');

function accessToken(): string {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN;
  // The Supabase CLI login, kept in the macOS keychain.
  const raw = execFileSync('security', ['find-generic-password', '-s', 'Supabase CLI', '-a', 'supabase', '-w'], {
    encoding: 'utf8',
  }).trim();
  return raw.startsWith('go-keyring-base64:')
    ? Buffer.from(raw.slice('go-keyring-base64:'.length), 'base64').toString('utf8')
    : raw;
}

function sqlString(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const reapplyChanged = args.includes('--reapply-changed');

  config({ path: join(ROOT, ENV_FILES.sandbox), override: true, quiet: true });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const ref = url ? new URL(url).hostname.split('.')[0] : '';
  if (ref !== PROJECT_REFS.sandbox) {
    throw new Error(`${ENV_FILES.sandbox} points at '${ref}', not the sandbox ${PROJECT_REFS.sandbox}: stopped`);
  }
  console.log(`target: sandbox · project ${ref}${dryRun ? ' · dry run' : ''}`);

  const token = accessToken();
  const query = async <T = Record<string, unknown>>(sql: string): Promise<T[]> => {
    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.slice(0, 500)}`);
    return JSON.parse(body) as T[];
  };

  await query(`
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (
      version text primary key, statements text[], name text);
    create table if not exists supabase_migrations.fase2_files (
      name text primary key, md5 text not null, applied_at timestamptz not null default now());`);

  const appliedVersions = new Set(
    (await query<{ version: string }>('select version from supabase_migrations.schema_migrations')).map((r) => r.version),
  );
  const appliedFiles = new Map(
    (await query<{ name: string; md5: string }>('select name, md5 from supabase_migrations.fase2_files')).map((r) => [
      r.name,
      r.md5,
    ]),
  );

  type Step = { label: string; sql: string; record: string };
  const steps: Step[] = [];
  const changed: string[] = [];

  const migrationsDir = join(ROOT, 'supabase/migrations');
  const migrations = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of migrations) {
    const [version, ...rest] = f.replace(/\.sql$/, '').split('_');
    if (appliedVersions.has(version)) continue;
    steps.push({
      label: f,
      sql: readFileSync(join(migrationsDir, f), 'utf8'),
      record: `insert into supabase_migrations.schema_migrations (version, name) values (${sqlString(version)}, ${sqlString(rest.join('_'))});`,
    });
  }

  const tracked = (name: string, path: string) => {
    const sql = readFileSync(path, 'utf8');
    const md5 = createHash('md5').update(sql).digest('hex');
    const prev = appliedFiles.get(name);
    if (prev === md5) return;
    if (prev && !reapplyChanged) {
      changed.push(name);
      return;
    }
    steps.push({
      label: prev ? `${name} (changed, re-applied)` : name,
      sql,
      record:
        `insert into supabase_migrations.fase2_files (name, md5) values (${sqlString(name)}, ${sqlString(md5)}) ` +
        `on conflict (name) do update set md5 = excluded.md5, applied_at = now();`,
    });
  };

  // The R1 contract, while it still lives in supabase/rollback/ (run.sh:14-19).
  if (!migrations.some((f) => f.endsWith('_fase1_r1_contract.sql'))) {
    tracked('rollback/fase1_r1_recontract.sql', join(ROOT, 'supabase/rollback/fase1_r1_recontract.sql'));
  }
  // Fase 2, until the promotion turns it into *_fase2_* migrations.
  if (!migrations.some((f) => f.includes('_fase2_'))) {
    const dir = join(ROOT, 'supabase/fase2');
    if (existsSync(dir)) {
      for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
        tracked(`fase2/${f}`, join(dir, f));
      }
    }
  }

  if (changed.length) {
    throw new Error(
      `applied files changed since: ${changed.join(', ')}. Re-run with --reapply-changed if they are re-runnable, ` +
        'otherwise write the change as a new file.',
    );
  }
  if (steps.length === 0) {
    console.log('OK: nothing pending');
    return;
  }
  for (const step of steps) {
    if (dryRun) {
      console.log(`pending: ${step.label}`);
      continue;
    }
    process.stdout.write(`migrate: ${step.label} … `);
    // File and bookkeeping in one request, so one transaction.
    await query(`${step.sql}\n;\n${step.record}`);
    console.log('ok');
  }
  console.log(dryRun ? `${steps.length} pending` : `OK: ${steps.length} applied to ${basename(url)}`);
}

main().catch((err) => {
  console.error('FAIL:', (err as Error).message);
  process.exit(1);
});
