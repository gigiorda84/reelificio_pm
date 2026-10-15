'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { MAX_IDEAS_PER_BATCH } from './constants';

// Writes of the ideas backlog through the SQL functions of
// supabase/fase2/040_ideas.sql, which check the caller (admin or RACI
// Responsible of the writing) and the transitions again.

export type IdeaActionResult =
  | { ok: true; id?: string; batchId?: string }
  | { ok: false; error: 'invalid_input' | 'not_authorized' | 'invalid_state' | 'stale' | 'unknown' };

const CODES = ['invalid_input', 'not_authorized', 'invalid_state', 'stale'] as const;
const uuid = z.string().uuid();

function fail(code: unknown): IdeaActionResult {
  return { ok: false, error: (CODES as readonly unknown[]).includes(code) ? (code as (typeof CODES)[number]) : 'unknown' };
}

export async function saveIdea(
  pageId: string,
  input: { id: string | null; title: string; spunto: string | null },
): Promise<IdeaActionResult> {
  const title = input.title.trim();
  if (!uuid.safeParse(pageId).success || (input.id !== null && !uuid.safeParse(input.id).success)
      || title.length < 1 || title.length > 200 || (input.spunto ?? '').length > 2000) {
    return { ok: false, error: 'invalid_input' };
  }
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase.rpc('upsert_idea', {
    p_id: input.id,
    p_page_id: pageId,
    p_title: title,
    p_spunto: input.spunto,
  });
  if (error) {
    console.error('[ideas] upsert_idea failed', error.code);
    return { ok: false, error: 'unknown' };
  }
  if (data?.code !== 'ok') return fail(data?.code);
  revalidatePath(`/pages/${pageId}/idee`);
  return { ok: true, id: data.id as string };
}

export async function setIdeaStatus(
  pageId: string,
  id: string,
  status: 'backlog' | 'scartata',
): Promise<IdeaActionResult> {
  if (!uuid.safeParse(pageId).success || !uuid.safeParse(id).success || !['backlog', 'scartata'].includes(status)) {
    return { ok: false, error: 'invalid_input' };
  }
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase.rpc('set_idea_status', { p_id: id, p_status: status });
  if (error) {
    console.error('[ideas] set_idea_status failed', error.code);
    return { ok: false, error: 'unknown' };
  }
  if (data !== 'ok') return fail(data);
  revalidatePath(`/pages/${pageId}/idee`);
  return { ok: true };
}

// A new batch for (year, month), or more reels in an existing batch born
// from ideas of the same page.
export async function createBatchFromIdeas(
  pageId: string,
  target: { year: number; month: number } | { batchId: string },
  ideaIds: string[],
): Promise<IdeaActionResult> {
  const ids = z.array(uuid).min(1).max(MAX_IDEAS_PER_BATCH).safeParse(ideaIds);
  const batchId = 'batchId' in target ? target.batchId : null;
  if (!uuid.safeParse(pageId).success || !ids.success || (batchId !== null && !uuid.safeParse(batchId).success)) {
    return { ok: false, error: 'invalid_input' };
  }
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase.rpc('create_batch_from_ideas', {
    p_page_id: pageId,
    p_year: 'year' in target ? target.year : null,
    p_month: 'month' in target ? target.month : null,
    p_idea_ids: ids.data,
    p_batch_id: batchId,
  });
  if (error) {
    console.error('[ideas] create_batch_from_ideas failed', error.code);
    return { ok: false, error: 'unknown' };
  }
  if (data?.code !== 'ok') return fail(data?.code);
  revalidatePath(`/pages/${pageId}/idee`);
  revalidatePath('/batches');
  return { ok: true, batchId: data.batch_id as string };
}
