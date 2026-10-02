// Staging fixture for the Fase 1 end-to-end scenarios (docs/fase1-plan.md
// §7.3). Staging only; safe to run again.
//
//   pnpm exec tsx scripts/fase1-seed-staging.ts --as hello@reelificio.com
//
// - Internal test users: author, approver, delegate, SMM.
// - External test users: two dubbers, two animators, a validator.
//   All addresses are plus-aliases of the --as admin's mailbox, so every
//   magic link lands in one inbox. No email is sent by this script.
// - Page "Pagina Test" (prefix TT, active = false so it raises no buffer
//   alert) in its own approval group, with titulars, reserves, validator and
//   RACI (author on script_writing, SMM on publication).
// - Batch "Batch Novembre" with three reels in idea, script filled in.
import { applyImport, loadExistingProfiles, planImport } from '../src/lib/collaborators/admin';
import { loadTarget } from './lib/target';

type Person = { key: string; name: string };

const INTERNALS: Person[] = [
  { key: 'autore', name: 'Autore Test' },
  { key: 'approvatore', name: 'Approvatore Test' },
  { key: 'delegato', name: 'Delegato Test' },
  { key: 'smm', name: 'SMM Test' },
];
const EXTERNALS: (Person & { kind: 'dubber' | 'animator' | 'validator' })[] = [
  { key: 'doppiatore', name: 'Doppiatore Test', kind: 'dubber' },
  { key: 'doppiatore2', name: 'Doppiatore Riserva', kind: 'dubber' },
  { key: 'animatore', name: 'Animatore Test', kind: 'animator' },
  { key: 'animatore2', name: 'Animatore Riserva', kind: 'animator' },
  { key: 'validatore', name: 'Validatore Test', kind: 'validator' },
];

const REELS = [
  { ordinal: 1, title: 'Perché il porcino non si lava', hook: 'Lo sapevi che il porcino non va mai lavato?', corpo: 'Assorbe acqua come una spugna e perde profumo.' },
  { ordinal: 2, title: 'Il segreto della papaya', hook: 'La papaya ha un enzima che…', corpo: 'La papaina scioglie le proteine della carne.' },
  { ordinal: 3, title: 'Funghi e luna piena', hook: 'Raccogliere funghi con la luna piena?', corpo: 'Un mito che resiste da secoli.' },
];

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data as T;
}

async function main() {
  const { admin, args } = await loadTarget(process.argv.slice(2), { allowProduction: false });
  const i = args.indexOf('--as');
  const asEmail = i >= 0 ? args[i + 1]?.toLowerCase() : undefined;
  if (!asEmail) throw new Error('--as <admin email> is required');
  const [local, domain] = asEmail.split('@');
  const alias = (key: string) => `${local}+${key}@${domain}`;

  const actor = must(
    await admin.from('profiles').select('id, is_admin').eq('email', asEmail).maybeSingle(),
    'admin',
  ) as { id: string; is_admin: boolean } | null;
  if (!actor?.is_admin) throw new Error(`${asEmail} is not an admin`);

  // Internals: created as internal (app_metadata) and set explicitly.
  const ids = new Map<string, string>();
  for (const p of INTERNALS) {
    const email = alias(p.key);
    const existing = must(await admin.from('profiles').select('id').eq('email', email).maybeSingle(), email) as
      | { id: string }
      | null;
    let id = existing?.id;
    if (!id) {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        app_metadata: { account_type: 'internal' },
        user_metadata: { full_name: p.name },
      });
      if (error || !data.user) throw new Error(`${email}: ${error?.message}`);
      id = data.user.id;
    }
    must(
      await admin.from('profiles').update({ account_type: 'internal', external_kind: null, full_name: p.name }).eq('id', id).select('id'),
      `profile ${email}`,
    );
    ids.set(p.key, id);
  }

  // Externals: the same path as release step 6b.
  const rows = EXTERNALS.map((p) => ({ email: alias(p.key), full_name: p.name, external_kind: p.kind, drive_email: null }));
  const plan = planImport(rows, await loadExistingProfiles(admin, rows.map((r) => r.email)), { convertExisting: false });
  const refused = plan.filter((p) => p.action === 'refuse');
  if (refused.length) throw new Error(`refused: ${refused.map((p) => p.row.email).join(', ')}`);
  const externalIds = await applyImport(admin, actor.id, plan);
  for (const p of EXTERNALS) ids.set(p.key, externalIds.get(alias(p.key))!);

  // Approval group for the test page only.
  let group = must(await admin.from('approval_groups').select('id').eq('name', 'Gruppo Test').maybeSingle(), 'group') as
    | { id: string }
    | null;
  if (!group) {
    group = must(
      await admin.from('approval_groups').insert({ name: 'Gruppo Test' }).select('id').single(),
      'insert group',
    ) as { id: string };
  }
  must(
    await admin.from('approval_groups')
      .update({ approver_id: ids.get('approvatore'), delegate_id: ids.get('delegato') })
      .eq('id', group.id).select('id'),
    'group people',
  );

  // Page.
  const pageFields = {
    name: 'Pagina Test',
    code_prefix: 'TT',
    active: false,
    requires_scientific_validation: false,
    dubber_titular_id: ids.get('doppiatore'),
    dubber_reserve_id: ids.get('doppiatore2'),
    animator_titular_id: ids.get('animatore'),
    animator_reserve_id: ids.get('animatore2'),
    validator_id: ids.get('validatore'),
    approval_group_id: group.id,
  };
  const page = must(
    await admin.from('pages').upsert({ slug: 'pagina-test', ...pageFields }, { onConflict: 'slug' }).select('id').single(),
    'page',
  ) as { id: string };

  must(
    await admin.from('raci_configs').upsert(
      [
        { page_id: page.id, phase: 'script_writing', responsible: [ids.get('autore')], approver: [ids.get('approvatore')] },
        { page_id: page.id, phase: 'publication', responsible: [ids.get('smm')], approver: [ids.get('approvatore')] },
      ],
      { onConflict: 'page_id,phase' },
    ).select('page_id'),
    'raci',
  );

  // Batch and reels.
  let batch = must(
    await admin.from('batches').select('id').eq('page_id', page.id).eq('label', 'Batch Novembre').maybeSingle(),
    'batch',
  ) as { id: string } | null;
  if (!batch) {
    batch = must(
      await admin.from('batches').insert({ page_id: page.id, label: 'Batch Novembre', status: 'active', created_by: actor.id })
        .select('id').single(),
      'insert batch',
    ) as { id: string };
  }
  for (const r of REELS) {
    const code = `TT-2611-${String(r.ordinal).padStart(2, '0')}`;
    const existing = must(await admin.from('reels').select('id').eq('code', code).maybeSingle(), code) as { id: string } | null;
    if (existing) continue;
    must(
      await admin.from('reels').insert({
        batch_id: batch.id, page_id: page.id, code, ordinal: r.ordinal, title: r.title,
        format: 'other', hook: r.hook, corpo: r.corpo, chiusura: 'Seguici per altri segreti.', cta: 'Salva il reel!',
      }).select('id'),
      `insert ${code}`,
    );
  }

  console.log(`OK: Pagina Test (TT), batch ${batch.id}`);
  for (const [key, id] of ids) console.log(`  ${alias(key).padEnd(40)} ${id}`);
}

main().catch((err) => {
  console.error('FAIL:', (err as Error).message);
  process.exit(1);
});
