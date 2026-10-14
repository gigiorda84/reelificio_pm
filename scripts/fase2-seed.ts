// Fixture for the Fase 2 sandbox (docs/fase2-plan.md S0, §7.3). Sandbox
// only; safe to run again.
//
//   pnpm exec tsx scripts/fase2-seed.ts [--as hello@reelificio.com] [--no-bible]
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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bibleSchema, voiceSchema } from '../src/lib/bible/schema';
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

  // 3. The P&P bible on Pagina Test, only while the bible is still empty
  // (version 1), so a later e2e edit is never overwritten. Written with the
  // service role: save_bible() needs a signed-in editor.
  if (!args.includes('--no-bible')) {
    const fixture = JSON.parse(readFileSync(join(__dirname, '../tests/fixtures/bible-porcino-papaya.json'), 'utf8'));
    const bible = bibleSchema.parse(fixture.bible);
    const voice = voiceSchema.parse(fixture.voice);
    const page = await admin.from('pages').select('id').eq('slug', 'pagina-test').single();
    if (page.error) throw new Error(`page: ${page.error.message}`);
    const current = await admin.from('page_bibles').select('version').eq('page_id', page.data.id).maybeSingle();
    if (current.error) throw new Error(`bible: ${current.error.message}`);
    if (!current.data || current.data.version === 1) {
      const b = await admin
        .from('page_bibles')
        .upsert({ page_id: page.data.id, ...bible, version: 2, updated_by: id }, { onConflict: 'page_id' })
        .select('id');
      const v = await admin
        .from('voice_briefs')
        .upsert({ page_id: page.data.id, ...voice, updated_by: id }, { onConflict: 'page_id' })
        .select('id');
      if (b.error || v.error) throw new Error(`bible seed: ${b.error?.message ?? v.error?.message}`);
      console.log('bible: Porcino & Papaya on Pagina Test');
    } else {
      console.log(`bible: already edited (version ${current.data.version}), left as is`);
    }
  }

  // 4. From S4: three fake AI alternatives per reel of Pagina Test, for the
  // alternatives panel before the generation exists (F2-E6, F2-E7). Only on
  // reels that have none yet.
  if (!args.includes('--no-alternatives')) {
    const page = await admin.from('pages').select('id').eq('slug', 'pagina-test').single();
    if (page.error) throw new Error(`page: ${page.error.message}`);
    const reels = await admin.from('reels').select('id, title').eq('page_id', page.data.id);
    if (reels.error) throw new Error(`reels: ${reels.error.message}`);
    let added = 0;
    for (const reel of reels.data ?? []) {
      const has = await admin.from('script_versions').select('id').eq('reel_id', reel.id).eq('source', 'ai').limit(1);
      if (has.error) throw new Error(`alternatives: ${has.error.message}`);
      if (has.data?.length) continue;
      const ins = await admin.from('script_versions').insert(fakeAlternatives(reel.id, reel.title as string));
      if (ins.error) throw new Error(`alternatives: ${ins.error.message}`);
      added += 1;
    }
    console.log(`alternatives: ${added} reel(s) got 3 fake AI alternatives`);
  }

  console.log('OK: sandbox seeded');
}

// Three recognisably different scripts in the Porcino & Papaya style, labelled
// with fake model ids (no model was called).
function fakeAlternatives(reelId: string, title: string) {
  const t = title.toLowerCase();
  return [
    {
      reel_id: reelId, source: 'ai', model: 'demo/alpha',
      hook: `Lo sapevi? ${title}.`,
      corpo: `Partiamo dai dati.\nSu ${t} quasi tutti sbagliano.\nE il motivo è semplice…\nnessuno te l'ha mai spiegato.`,
      chiusura: `Porcino: "Io lo sapevo."\nPapaya: "Certo. Come sempre."`,
      cta: 'Seguici. Che qui i dati fanno più rumore delle opinioni.',
      notes: 'Regia: Porcino in primo piano, Papaya entra secca sulla chiusura.',
    },
    {
      reel_id: reelId, source: 'ai', model: 'demo/beta',
      hook: `Ferma tutto: ${t}.`,
      corpo: `Ti hanno raccontato una storia.\nLa realtà è un'altra.\nE fa anche un po' ridere.`,
      chiusura: `Papaya: "Ora lo sai."\nPorcino: "Ora lo sanno tutti."`,
      cta: 'Seguici. Perché queste cose non te le ha spiegate nessuno… e si vede.',
      notes: 'Regia: botta e risposta, ritmo veloce.',
    },
    {
      reel_id: reelId, source: 'ai', model: 'demo/gamma',
      hook: `${title}? Te lo spiego in trenta secondi.`,
      corpo: `Uno: non è come pensi.\nDue: c'è un motivo scientifico.\nTre: Porcino lo usa per fare il simpatico.`,
      chiusura: `Porcino: "Funziona."\nPapaya: "Su di te no."`,
      cta: 'Seguici. Che la mente umana è più strana del tuo algoritmo.',
      notes: 'Regia: elenco con i numeri a schermo.',
    },
  ];
}

main().catch((err) => {
  console.error('FAIL:', (err as Error).message);
  process.exit(1);
});
