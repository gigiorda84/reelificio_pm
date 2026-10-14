'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { fetchDocAsText, DriveFetchError } from '@/lib/drive/fetch';
import { parseScriptDoc } from '@/lib/parser/parse';
import { buildReelCode, detectBatchYearMonth } from './codes';
import type { ParsedReel } from '@/lib/parser/types';
import { REEL_STATES, type ReelState } from '@/lib/reels/constants';

const createBatchSchema = z.object({
  page_id: z.string().uuid(),
  source_doc_url: z.string().min(8),
  label_override: z.string().max(120).optional().nullable(),
});

export type CreateBatchResult =
  | { ok: true; id: string }
  | {
      ok: false;
      error:
        | 'invalid_input'
        | 'drive_invalid_url'
        | 'drive_not_found'
        | 'drive_forbidden'
        | 'drive_unsupported'
        | 'drive_unknown'
        | 'no_reels'
        | 'page_not_found'
        | 'not_admin'
        | 'unknown';
      message?: string;
    };

function readForm(formData: FormData) {
  return {
    page_id: formData.get('page_id')?.toString() ?? '',
    source_doc_url: formData.get('source_doc_url')?.toString() ?? '',
    label_override: (formData.get('label_override')?.toString() ?? '').trim() || null,
  };
}

function reelInsertPayload(
  parsed: ParsedReel,
  batchId: string,
  pageId: string,
  pagePrefix: string,
  year: number,
  month: number,
) {
  return {
    batch_id: batchId,
    page_id: pageId,
    code: buildReelCode(pagePrefix, year, month, parsed.ordinal),
    ordinal: parsed.ordinal,
    title: parsed.title,
    format: parsed.format,
    category: 'adapted' as const,
    hook: parsed.hook,
    corpo: parsed.corpo,
    chiusura: parsed.chiusura,
    cta: parsed.cta,
    notes: parsed.notes,
    raw_content: parsed.rawContent,
    parser_warning: parsed.parserWarning,
  };
}

export async function createBatch(
  formData: FormData,
): Promise<CreateBatchResult> {
  const parsed = createBatchSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return { ok: false, error: 'invalid_input' };
  }
  const { page_id, source_doc_url, label_override } = parsed.data;

  const supabase = await getSupabaseServerClient();

  const { data: page, error: pageError } = await supabase
    .from('pages')
    .select('id, name, code_prefix')
    .eq('id', page_id)
    .maybeSingle();
  if (pageError || !page) {
    return { ok: false, error: 'page_not_found' };
  }

  let doc;
  try {
    doc = await fetchDocAsText(source_doc_url);
  } catch (err) {
    console.error('[createBatch] Drive fetch failed', {
      url: source_doc_url,
      kind: err instanceof DriveFetchError ? err.kind : 'non_drive_error',
      message: (err as Error)?.message,
    });
    if (err instanceof DriveFetchError) {
      const map: Record<DriveFetchError['kind'], CreateBatchResult> = {
        invalid_url: { ok: false, error: 'drive_invalid_url', message: err.message },
        not_found: { ok: false, error: 'drive_not_found', message: err.message },
        forbidden: { ok: false, error: 'drive_forbidden', message: err.message },
        unsupported_type: { ok: false, error: 'drive_unsupported', message: err.message },
        not_configured: { ok: false, error: 'drive_unknown', message: err.message },
        unknown: { ok: false, error: 'drive_unknown', message: err.message },
      };
      return map[err.kind];
    }
    return { ok: false, error: 'drive_unknown', message: (err as Error).message };
  }

  const parsedDoc = parseScriptDoc(doc.text);
  if (parsedDoc.reels.length === 0) {
    return { ok: false, error: 'no_reels' };
  }

  const label = label_override || parsedDoc.batchLabel || `Batch ${page.name}`;
  const { year, month } = detectBatchYearMonth(parsedDoc.batchLabel);

  const { data: inserted, error: insertError } = await supabase
    .from('batches')
    .insert({
      page_id,
      label,
      source_doc_url,
      source_doc_id: doc.fileId,
      source_doc_revision_id: doc.revisionId,
      source_doc_synced_at: new Date().toISOString(),
      status: 'draft',
    })
    .select('id')
    .single();

  if (insertError || !inserted) {
    if (
      insertError?.code === '42501' ||
      insertError?.message.toLowerCase().includes('row-level security')
    ) {
      return { ok: false, error: 'not_admin' };
    }
    return { ok: false, error: 'unknown', message: insertError?.message };
  }

  const reelRows = parsedDoc.reels.map((reel) =>
    reelInsertPayload(reel, inserted.id, page_id, page.code_prefix, year, month),
  );

  const { error: reelError } = await supabase.from('reels').insert(reelRows);

  if (reelError) {
    // Roll back the batch so the user can retry without orphaned state.
    await supabase.from('batches').delete().eq('id', inserted.id);
    return { ok: false, error: 'unknown', message: reelError.message };
  }

  revalidatePath('/batches');
  redirect(`/batches/${inserted.id}`);
}

export type ResyncDiff = {
  added: number[];
  removed: number[];
  changed: { ordinal: number; fields: string[] }[];
  // Changed in the doc but already in production (from revisione on): the
  // script is locked, so re-sync leaves them alone; changes go through a
  // proposal (docs/fase1-plan.md §3).
  locked: { ordinal: number; fields: string[] }[];
  unchanged: number[];
  warnings: string[];
};

export type ResyncPreviewResult =
  | { ok: true; diff: ResyncDiff; pageInfo: { name: string; codePrefix: string } }
  | { ok: false; error: CreateBatchResult extends { error: infer E } ? E : never; message?: string };

// The diff, plus the id and script revision of each existing reel as read
// for it: the apply step saves with that revision (Fase 2 save_reel_script),
// so a reel edited in the meantime is reported as a conflict, not overwritten.
async function diffParsedAgainstBatch(
  batchId: string,
  parsedReels: ParsedReel[],
): Promise<{ diff: ResyncDiff; revs: Map<number, { id: string; script_rev: number }> }> {
  const supabase = await getSupabaseServerClient();
  const { data: existing } = await supabase
    .from('reels')
    .select('id, ordinal, state, script_rev, title, format, hook, corpo, chiusura, cta, notes, parser_warning')
    .eq('batch_id', batchId);
  const revs = new Map(
    (existing ?? []).map((r) => [r.ordinal as number, { id: r.id as string, script_rev: r.script_rev as number }]),
  );

  const byOrdinal = new Map(
    (existing ?? []).map((r) => [r.ordinal as number, r]),
  );
  const parsedByOrdinal = new Map(parsedReels.map((r) => [r.ordinal, r]));

  const added: number[] = [];
  const removed: number[] = [];
  const changed: ResyncDiff['changed'] = [];
  const locked: ResyncDiff['locked'] = [];
  const unchanged: number[] = [];
  const lockFrom = REEL_STATES.indexOf('revisione');

  for (const [ordinal, parsed] of parsedByOrdinal) {
    const ex = byOrdinal.get(ordinal);
    if (!ex) {
      added.push(ordinal);
      continue;
    }
    const fields: string[] = [];
    if (ex.title !== parsed.title) fields.push('title');
    if (ex.format !== parsed.format) fields.push('format');
    if ((ex.hook ?? null) !== (parsed.hook ?? null)) fields.push('hook');
    if ((ex.corpo ?? null) !== (parsed.corpo ?? null)) fields.push('corpo');
    if ((ex.chiusura ?? null) !== (parsed.chiusura ?? null)) fields.push('chiusura');
    if ((ex.cta ?? null) !== (parsed.cta ?? null)) fields.push('cta');
    if ((ex.notes ?? null) !== (parsed.notes ?? null)) fields.push('notes');
    if (fields.length > 0 && REEL_STATES.indexOf(ex.state as ReelState) >= lockFrom) {
      locked.push({ ordinal, fields });
    } else if (fields.length > 0) {
      changed.push({ ordinal, fields });
    } else {
      unchanged.push(ordinal);
    }
  }
  for (const ordinal of byOrdinal.keys()) {
    if (!parsedByOrdinal.has(ordinal)) removed.push(ordinal);
  }
  added.sort((a, b) => a - b);
  removed.sort((a, b) => a - b);
  unchanged.sort((a, b) => a - b);
  changed.sort((a, b) => a.ordinal - b.ordinal);
  locked.sort((a, b) => a.ordinal - b.ordinal);

  return { diff: { added, removed, changed, locked, unchanged, warnings: [] }, revs };
}

export async function resyncBatch(
  batchId: string,
  options: { apply: boolean },
): Promise<
  | { ok: true; diff: ResyncDiff; applied: boolean }
  | {
      ok: false;
      error:
        | 'batch_not_found'
        | 'page_not_found'
        | 'no_source_doc'
        | 'drive_invalid_url'
        | 'drive_not_found'
        | 'drive_forbidden'
        | 'drive_unsupported'
        | 'drive_unknown'
        | 'no_reels'
        | 'not_admin'
        | 'unknown';
      message?: string;
    }
> {
  const supabase = await getSupabaseServerClient();

  const { data: batch } = await supabase
    .from('batches')
    .select('id, page_id, source_doc_id, source_doc_url')
    .eq('id', batchId)
    .maybeSingle();
  if (!batch) return { ok: false, error: 'batch_not_found' };
  if (!batch.source_doc_id && !batch.source_doc_url) {
    return { ok: false, error: 'no_source_doc' };
  }

  const { data: page } = await supabase
    .from('pages')
    .select('id, code_prefix')
    .eq('id', batch.page_id)
    .maybeSingle();
  if (!page) return { ok: false, error: 'page_not_found' };

  let doc;
  try {
    doc = await fetchDocAsText(batch.source_doc_id ?? batch.source_doc_url ?? '');
  } catch (err) {
    if (err instanceof DriveFetchError) {
      const map: Record<DriveFetchError['kind'], 'drive_invalid_url' | 'drive_not_found' | 'drive_forbidden' | 'drive_unsupported' | 'drive_unknown'> = {
        invalid_url: 'drive_invalid_url',
        not_found: 'drive_not_found',
        forbidden: 'drive_forbidden',
        unsupported_type: 'drive_unsupported',
        not_configured: 'drive_unknown',
        unknown: 'drive_unknown',
      };
      return { ok: false, error: map[err.kind], message: err.message };
    }
    return { ok: false, error: 'drive_unknown', message: (err as Error).message };
  }

  const parsedDoc = parseScriptDoc(doc.text);
  if (parsedDoc.reels.length === 0) {
    return { ok: false, error: 'no_reels' };
  }

  const { diff, revs } = await diffParsedAgainstBatch(batchId, parsedDoc.reels);
  diff.warnings = parsedDoc.warnings;

  if (!options.apply) {
    return { ok: true, diff, applied: false };
  }

  // Apply: insert new reels, update changed reels. Removed reels are kept
  // (production work may be in flight); they are simply flagged in the diff.
  const { year, month } = detectBatchYearMonth(parsedDoc.batchLabel);
  const newReelOrdinals = new Set(diff.added);
  const changedOrdinals = new Set(diff.changed.map((c) => c.ordinal));

  const inserts = parsedDoc.reels
    .filter((r) => newReelOrdinals.has(r.ordinal))
    .map((r) =>
      reelInsertPayload(r, batchId, batch.page_id, page.code_prefix, year, month),
    );

  if (inserts.length > 0) {
    const { error: insertErr } = await supabase.from('reels').insert(inserts);
    if (insertErr) {
      if (
        insertErr.code === '42501' ||
        insertErr.message.toLowerCase().includes('row-level security')
      ) {
        return { ok: false, error: 'not_admin' };
      }
      return { ok: false, error: 'unknown', message: insertErr.message };
    }
  }

  // Through save_reel_script (Fase 2): a `resync` version per reel, saved
  // only at the revision the diff read. A reel edited since then (stale) or
  // locked in the meantime moves to the conflicts instead of being overwritten.
  const updates = parsedDoc.reels.filter((r) => changedOrdinals.has(r.ordinal));
  for (const r of updates) {
    const rev = revs.get(r.ordinal);
    if (!rev) continue;
    const { data: code, error: updErr } = await supabase.rpc('save_reel_script', {
      p_reel_id: rev.id,
      p_fields: {
        title: r.title,
        format: r.format,
        hook: r.hook,
        corpo: r.corpo,
        chiusura: r.chiusura,
        cta: r.cta,
        notes: r.notes,
        raw_content: r.rawContent,
        parser_warning: r.parserWarning,
      },
      p_expected_rev: rev.script_rev,
      p_source: 'resync',
    });
    if (updErr) {
      return { ok: false, error: 'unknown', message: updErr.message };
    }
    if (code === 'stale' || code === 'not_authorized') {
      const entry = diff.changed.find((c) => c.ordinal === r.ordinal);
      diff.changed = diff.changed.filter((c) => c.ordinal !== r.ordinal);
      if (entry) diff.locked.push(entry);
    } else if (code === 'invalid_input') {
      // `resync` is for admins only.
      return { ok: false, error: 'not_admin' };
    } else if (code !== 'ok') {
      return { ok: false, error: 'unknown', message: String(code) };
    }
  }

  await supabase
    .from('batches')
    .update({
      source_doc_synced_at: new Date().toISOString(),
      source_doc_revision_id: doc.revisionId,
    })
    .eq('id', batchId);

  revalidatePath(`/batches/${batchId}`);
  return { ok: true, diff, applied: true };
}
