import { getSupabaseServerClient } from '@/lib/supabase/server';
import { BIBLE_LIMITS } from '@/lib/bible/schema';
import { runChecks, type CheckWarning, type RecentClosing, type ScriptBlocks } from './checks';

// What the checks need from the database (docs/fase2-plan.md S5): the banned
// words of the page's Voce, the duration range of its bible, and the CTAs and
// closings of its last 20 reels. Internals only (page_bibles is RLS-internal).

export type PageCheckContext = {
  bannedWords: string[];
  duration: { min: number | null; max: number | null; wordsPerSecond: number };
};

export const RECENT_LIMIT = 20;

export type CheckableReel = ScriptBlocks & { id: string; page_id: string };

async function loadContexts(pageIds: string[]): Promise<Map<string, PageCheckContext>> {
  const supabase = await getSupabaseServerClient();
  const [voices, bibles] = await Promise.all([
    supabase.from('voice_briefs').select('page_id, banned_words').in('page_id', pageIds),
    supabase.from('page_bibles').select('page_id, duration_min_s, duration_max_s, words_per_second').in('page_id', pageIds),
  ]);
  if (voices.error) throw voices.error;
  if (bibles.error) throw bibles.error;
  const banned = new Map((voices.data ?? []).map((v) => [v.page_id as string, (v.banned_words as string[]) ?? []]));
  const contexts = new Map<string, PageCheckContext>();
  for (const pageId of pageIds) {
    const b = (bibles.data ?? []).find((x) => x.page_id === pageId);
    contexts.set(pageId, {
      bannedWords: banned.get(pageId) ?? [],
      duration: {
        min: (b?.duration_min_s as number | null) ?? null,
        max: (b?.duration_max_s as number | null) ?? null,
        wordsPerSecond: Number(b?.words_per_second ?? BIBLE_LIMITS.wordsPerSecond.default),
      },
    });
  }
  return contexts;
}

// The newest reels of a page with a CTA or a closing: enough rows to drop the
// reels being checked and still keep RECENT_LIMIT for each of them.
async function loadRecent(pageId: string, extra: number): Promise<(RecentClosing & { id: string })[]> {
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from('reels')
    .select('id, code, cta, chiusura')
    .eq('page_id', pageId)
    .or('cta.not.is.null,chiusura.not.is.null')
    .order('created_at', { ascending: false })
    .limit(RECENT_LIMIT + extra);
  if (error) throw error;
  return (data ?? []) as (RecentClosing & { id: string })[];
}

// Warnings for each reel, keyed by reel id: one query per table and page.
export async function checkReels(reels: CheckableReel[]): Promise<Map<string, CheckWarning[]>> {
  const out = new Map<string, CheckWarning[]>();
  if (reels.length === 0) return out;
  const pageIds = [...new Set(reels.map((r) => r.page_id))];
  const contexts = await loadContexts(pageIds);
  const recentByPage = new Map(
    await Promise.all(
      pageIds.map(async (p) => [p, await loadRecent(p, reels.filter((r) => r.page_id === p).length)] as const),
    ),
  );
  for (const reel of reels) {
    const context = contexts.get(reel.page_id)!;
    const recent = (recentByPage.get(reel.page_id) ?? []).filter((r) => r.id !== reel.id).slice(0, RECENT_LIMIT);
    out.set(
      reel.id,
      runChecks({
        blocks: { hook: reel.hook, corpo: reel.corpo, chiusura: reel.chiusura, cta: reel.cta },
        bannedWords: context.bannedWords,
        duration: context.duration,
        recent,
      }),
    );
  }
  return out;
}
