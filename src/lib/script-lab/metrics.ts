import 'server-only';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import type { BibleGap } from '@/lib/bible/schema';

// The Script Lab metrics for admins (docs/fase2-plan.md S7, AC22–AC25),
// from script_lab_metrics (supabase/fase2/050_metrics.sql). Months are
// "YYYY-MM" in Rome. Costs and the Script Lab split of the send-backs come
// with the AI generation (S6).

export type SendbackRow = { month: string; reviewed: number; sent_back: number };
export type BatchRow = { month: string; origin: 'import' | 'ideas'; batches: number; reels: number };
export type BiblePage = { page_id: string; name: string; missing: BibleGap[] };
export type AuthorRow = { month: string; author_id: string | null; name: string | null; reels: number };
export type ProvenanceRow = {
  month: string;
  delivered: number;
  mixed: number;
  edited_after_mix: number;
  // Model id, or `manuale`, → count.
  bases: Record<string, number>;
  blocks: Record<string, number>;
};

export type ScriptLabMetrics = {
  from: string;
  to: string;
  sendback: SendbackRow[];
  batches: BatchRow[];
  bibles: { active_pages: number; complete: number; pages: BiblePage[] };
  authors: AuthorRow[];
  provenance: ProvenanceRow[];
};

export async function getScriptLabMetrics(period: { from: string; to: string }): Promise<ScriptLabMetrics> {
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase.rpc('script_lab_metrics', { p_from: period.from, p_to: period.to });
  if (error) throw error;
  return data as ScriptLabMetrics;
}
