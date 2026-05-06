// Exercises the full create-batch path end-to-end against the local Supabase.
// Bypasses RLS by using the service-role key directly. Run as:
//   pnpm exec tsx scripts/test-create-batch.ts <pageId> <docUrl>
import { config } from 'dotenv';
import ws from 'ws';
import { createClient } from '@supabase/supabase-js';
import { fetchDocAsText } from '../src/lib/drive/fetch';
import { parseScriptDoc } from '../src/lib/parser/parse';
import { buildReelCode, detectBatchYearMonth } from '../src/lib/batches/codes';

config({ path: '.env.local' });

async function main() {
  const pageId = process.argv[2];
  const docUrl = process.argv[3];
  if (!pageId || !docUrl) {
    console.error(
      'Usage: tsx scripts/test-create-batch.ts <pageId> <docUrlOrFileId>',
    );
    process.exit(1);
  }
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { realtime: { transport: ws as unknown as never } },
  );

  const { data: page, error: pageErr } = await supabase
    .from('pages')
    .select('id, name, code_prefix')
    .eq('id', pageId)
    .single();
  if (pageErr || !page) throw new Error(`Page not found: ${pageErr?.message}`);

  console.log('Fetching doc…');
  const doc = await fetchDocAsText(docUrl);
  console.log('  name:', doc.name);
  console.log('  revisionId:', doc.revisionId);

  console.log('Parsing…');
  const parsed = parseScriptDoc(doc.text);
  console.log('  reels:', parsed.reels.length);

  const label = parsed.batchLabel ?? `Batch ${page.name}`;
  const { year, month } = detectBatchYearMonth(parsed.batchLabel);

  console.log('Inserting batch…');
  const { data: batch, error: bErr } = await supabase
    .from('batches')
    .insert({
      page_id: page.id,
      label,
      source_doc_url: docUrl,
      source_doc_id: doc.fileId,
      source_doc_revision_id: doc.revisionId,
      source_doc_synced_at: new Date().toISOString(),
      status: 'draft',
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
    category: 'adapted',
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
  console.log('  batchId:', batch.id);
  console.log(
    '  codes:',
    reelRows
      .slice(0, 3)
      .map((r) => r.code)
      .join(', '),
    '…',
  );
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
