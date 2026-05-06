// One-shot seed: creates the Porcino & Papaya page (if missing) and imports
// the May batch from tests/fixtures/porcino-papaya-may.txt — bypassing the
// Drive fetch path so this works without GCP service-account creds.
//
// Run:
//   pnpm exec tsx scripts/seed-porcino-papaya-may.ts
import { readFileSync } from 'node:fs';
import { config } from 'dotenv';
import ws from 'ws';
import { createClient } from '@supabase/supabase-js';
import { parseScriptDoc } from '../src/lib/parser/parse';
import { buildReelCode, detectBatchYearMonth } from '../src/lib/batches/codes';

config({ path: '.env.local' });

const FIXTURE = 'tests/fixtures/porcino-papaya-may.txt';
const PAGE_SLUG = 'porcino-papaya';
const PAGE_NAME = 'Porcino & Papaya';
const PAGE_PREFIX = 'PP';
const DOC_URL =
  'https://docs.google.com/document/d/1iNJ2Nm099nlhLfbvMfpthwTojpW9oKC_/edit';
const DOC_ID = '1iNJ2Nm099nlhLfbvMfpthwTojpW9oKC_';

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { realtime: { transport: ws as unknown as never } },
  );

  // 1. Upsert the page.
  const { data: existing } = await supabase
    .from('pages')
    .select('id, name, code_prefix')
    .eq('slug', PAGE_SLUG)
    .maybeSingle();

  let page = existing;
  if (!page) {
    console.log('Creating page…');
    const { data, error } = await supabase
      .from('pages')
      .insert({
        slug: PAGE_SLUG,
        name: PAGE_NAME,
        code_prefix: PAGE_PREFIX,
        description: 'Pagina di sessuologia divulgativa.',
        active: true,
      })
      .select('id, name, code_prefix')
      .single();
    if (error) throw new Error(`Page insert: ${error.message}`);
    page = data;
  } else {
    console.log('Page exists:', page.name);
  }

  // 2. Parse the doc.
  console.log('Parsing fixture…');
  const text = readFileSync(FIXTURE, 'utf8');
  const parsed = parseScriptDoc(text);
  console.log('  reels:', parsed.reels.length);
  console.log('  batchLabel:', parsed.batchLabel);

  if (parsed.reels.length === 0) {
    throw new Error('Parser returned 0 reels — aborting.');
  }

  const label = parsed.batchLabel ?? `Batch ${page.name}`;
  const { year, month } = detectBatchYearMonth(parsed.batchLabel);

  // 3. Refuse to double-insert: if a batch with this label already exists for
  //    the page, bail with a clear message.
  const { data: dup } = await supabase
    .from('batches')
    .select('id')
    .eq('page_id', page.id)
    .eq('label', label)
    .maybeSingle();
  if (dup) {
    console.log(
      `Batch "${label}" already exists for ${page.name} (id=${dup.id}). Nothing to do.`,
    );
    return;
  }

  console.log('Inserting batch…');
  const { data: batch, error: bErr } = await supabase
    .from('batches')
    .insert({
      page_id: page.id,
      label,
      source_doc_url: DOC_URL,
      source_doc_id: DOC_ID,
      source_doc_revision_id: null,
      source_doc_synced_at: new Date().toISOString(),
      status: 'active',
    })
    .select('id')
    .single();
  if (bErr) throw new Error(`Batch insert: ${bErr.message}`);

  console.log('Inserting reels…');
  const reelRows = parsed.reels.map((r) => ({
    batch_id: batch.id,
    page_id: page.id,
    code: buildReelCode(page.code_prefix, year, month, r.ordinal),
    ordinal: r.ordinal,
    title: r.title,
    format: r.format,
    category: 'adapted' as const,
    hook: r.hook,
    corpo: r.corpo,
    chiusura: r.chiusura,
    cta: r.cta,
    notes: r.notes,
    raw_content: r.rawContent,
    parser_warning: r.parserWarning,
  }));
  const { error: rErr } = await supabase.from('reels').insert(reelRows);
  if (rErr) {
    await supabase.from('batches').delete().eq('id', batch.id);
    throw new Error(`Reel insert: ${rErr.message}`);
  }

  console.log('OK');
  console.log('  pageId :', page.id);
  console.log('  batchId:', batch.id);
  console.log(
    '  first 3 codes:',
    reelRows
      .slice(0, 3)
      .map((r) => r.code)
      .join(', '),
  );
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
