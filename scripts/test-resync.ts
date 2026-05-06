// Tests the resync diff logic against a synthetic change.
//   pnpm exec tsx scripts/test-resync.ts <batchId>
import { config } from 'dotenv';
import ws from 'ws';
import { createClient } from '@supabase/supabase-js';
import { fetchDocAsText } from '../src/lib/drive/fetch';
import { parseScriptDoc } from '../src/lib/parser/parse';

config({ path: '.env.local' });

async function main() {
  const batchId = process.argv[2];
  if (!batchId) {
    console.error('Usage: tsx scripts/test-resync.ts <batchId>');
    process.exit(1);
  }
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { realtime: { transport: ws as unknown as never } },
  );

  const { data: batch } = await supabase
    .from('batches')
    .select('id, source_doc_id, source_doc_url')
    .eq('id', batchId)
    .single();
  if (!batch) throw new Error('batch not found');

  const doc = await fetchDocAsText(batch.source_doc_id ?? batch.source_doc_url);
  const parsed = parseScriptDoc(doc.text);

  const { data: existing } = await supabase
    .from('reels')
    .select('ordinal, title, format, hook, corpo, chiusura, cta, notes')
    .eq('batch_id', batchId);

  const byOrd = new Map((existing ?? []).map((r) => [r.ordinal, r]));
  const parsedByOrd = new Map(parsed.reels.map((r) => [r.ordinal, r]));

  const added: number[] = [];
  const removed: number[] = [];
  const changed: { ordinal: number; fields: string[] }[] = [];
  const unchanged: number[] = [];

  for (const [ordinal, p] of parsedByOrd) {
    const ex = byOrd.get(ordinal);
    if (!ex) {
      added.push(ordinal);
      continue;
    }
    const fields: string[] = [];
    if (ex.title !== p.title) fields.push('title');
    if (ex.format !== p.format) fields.push('format');
    if ((ex.hook ?? null) !== (p.hook ?? null)) fields.push('hook');
    if ((ex.corpo ?? null) !== (p.corpo ?? null)) fields.push('corpo');
    if ((ex.chiusura ?? null) !== (p.chiusura ?? null)) fields.push('chiusura');
    if ((ex.cta ?? null) !== (p.cta ?? null)) fields.push('cta');
    if ((ex.notes ?? null) !== (p.notes ?? null)) fields.push('notes');
    if (fields.length > 0) changed.push({ ordinal, fields });
    else unchanged.push(ordinal);
  }
  for (const ord of byOrd.keys()) {
    if (!parsedByOrd.has(ord)) removed.push(ord);
  }

  console.log('Added    :', added);
  console.log('Removed  :', removed);
  console.log('Changed  :', changed);
  console.log('Unchanged:', unchanged.length, '(reels)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
