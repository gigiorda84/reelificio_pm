// Mix of script versions (docs/fase2-plan.md AC16): a base version and, for
// any of the four blocks, the text of another version of the same reel.
// The same composition runs in SQL (apply_script_version); this one drives
// the preview and sends only the blocks that differ from the base.

export const BLOCKS = ['hook', 'corpo', 'chiusura', 'cta'] as const;
export type Block = (typeof BLOCKS)[number];

export type VersionText = {
  id: string;
  model?: string | null;
  hook: string | null;
  corpo: string | null;
  chiusura: string | null;
  cta: string | null;
  notes?: string | null;
};

export type MixResult = {
  // The text the reel would get.
  blocks: Record<Block, string | null>;
  notes: string | null;
  // Version id each block comes from.
  sources: Record<Block, string>;
  // What apply_script_version needs: only the blocks not taken from the base.
  overrides: Partial<Record<Block, string>>;
};

// picks: block → version id; a missing pick, or the base itself, keeps the
// base. Null when the base or a picked version is unknown.
export function composeMix(
  baseId: string,
  picks: Partial<Record<Block, string>>,
  versions: VersionText[],
): MixResult | null {
  const byId = new Map(versions.map((v) => [v.id, v]));
  const base = byId.get(baseId);
  if (!base) return null;
  const blocks = {} as Record<Block, string | null>;
  const sources = {} as Record<Block, string>;
  const overrides: Partial<Record<Block, string>> = {};
  for (const block of BLOCKS) {
    const pick = picks[block];
    const from = pick ? byId.get(pick) : base;
    if (!from) return null;
    blocks[block] = from[block];
    sources[block] = from.id;
    if (from.id !== base.id) overrides[block] = from.id;
  }
  return { blocks, notes: base.notes ?? null, sources, overrides };
}

// True when applying would leave the text as it is (no version is written).
export function sameText(
  mix: Pick<MixResult, 'blocks' | 'notes'>,
  current: Pick<VersionText, Block | 'notes'>,
): boolean {
  return BLOCKS.every((b) => (mix.blocks[b] ?? null) === (current[b] ?? null)) && (mix.notes ?? null) === (current.notes ?? null);
}
