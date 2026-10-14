import { getSupabaseServerClient } from '@/lib/supabase/server';
import { EMPTY_BIBLE, firstNameOf, type BibleFields, type ExampleScript, type VoiceFields } from './schema';

// Reads for the page bible (docs/fase2-plan.md S2). page_bibles is visible to
// internals only (RLS); voice_briefs also to the externals of the page.

export type BibleRow = BibleFields & {
  version: number;
  updated_at: string | null;
};

const BIBLE_COLUMNS =
  'tone, characters, themes, keywords, allowed_ctas, duration_min_s, duration_max_s, ' +
  'words_per_second, example_scripts, default_models, version, updated_at';

export async function getBible(pageId: string): Promise<{ bible: BibleRow; voice: VoiceFields | null }> {
  const supabase = await getSupabaseServerClient();
  const [bibleRes, voiceRes] = await Promise.all([
    supabase.from('page_bibles').select(BIBLE_COLUMNS).eq('page_id', pageId).maybeSingle(),
    supabase
      .from('voice_briefs')
      .select('adjectives, banned_words, reference_audio_urls, allowed_liberties, anomaly_procedure')
      .eq('page_id', pageId)
      .maybeSingle(),
  ]);
  if (bibleRes.error) throw bibleRes.error;
  if (voiceRes.error) throw voiceRes.error;
  const row = bibleRes.data as (Omit<BibleRow, 'words_per_second'> & { words_per_second: number | string }) | null;
  // A page created before the bible trigger has no row yet: an empty bible
  // at version 1, which save_bible() creates on the first save.
  const bible: BibleRow = row
    ? { ...row, words_per_second: Number(row.words_per_second) }
    : { ...EMPTY_BIBLE, version: 1, updated_at: null };
  return { bible, voice: (voiceRes.data as VoiceFields | null) ?? null };
}

// Admins and the RACI Responsible of script_writing edit the bible
// (private._can_edit_script_lab); the SQL checks it again on save.
export async function canEditBible(pageId: string, viewer: { userId: string; isAdmin: boolean }): Promise<boolean> {
  if (viewer.isAdmin) return true;
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from('raci_configs')
    .select('responsible')
    .eq('page_id', pageId)
    .eq('phase', 'script_writing')
    .maybeSingle();
  if (error) throw error;
  return ((data?.responsible as string[] | undefined) ?? []).includes(viewer.userId);
}

// Approved scripts of the page, newest first, to copy into the examples.
export type ApprovedScript = ExampleScript & { id: string; code: string };

const APPROVED_STATES = ['confermato', 'doppiaggio', 'animazione', 'approvazione_finale', 'programmato', 'pubblicato'];

export async function listApprovedScripts(pageId: string, limit = 20): Promise<ApprovedScript[]> {
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from('reels')
    .select('id, code, title, hook, corpo, chiusura, cta')
    .eq('page_id', pageId)
    .in('state', APPROVED_STATES)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id as string,
    code: r.code as string,
    ...Object.fromEntries(
      (['title', 'hook', 'corpo', 'chiusura', 'cta'] as const)
        .filter((k) => typeof r[k] === 'string' && (r[k] as string).trim() !== '')
        .map((k) => [k, r[k] as string]),
    ),
  }));
}

// First names of every profile, for the editor's warning (internals read all
// profiles). Deactivated people included: their names must not leak either.
export async function listProfileFirstNames(): Promise<string[]> {
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase.from('profiles').select('full_name');
  if (error) throw error;
  const names = (data ?? []).map((p) => firstNameOf(p.full_name as string | null)).filter((n): n is string => !!n);
  return [...new Set(names)];
}
