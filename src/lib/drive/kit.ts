// The animator's kit (docs/fase1-plan.md §S5): the approved audio, already in
// the reel folder, plus the script as a text file. A legacy kit (audio
// approved as a link in R1) adds a text file with that link. Pure: the job
// writes what these return.

export type KitScript = {
  hook: string | null;
  corpo: string | null;
  chiusura: string | null;
  cta: string | null;
  raw_content: string | null;
  notes: string | null;
};

const BLOCKS: [keyof KitScript, string][] = [
  ['hook', 'HOOK'],
  ['corpo', 'CORPO'],
  ['chiusura', 'CHIUSURA'],
  ['cta', 'CTA'],
];

function present(s: string | null): s is string {
  return !!s && s.trim() !== '';
}

export function scriptKitText(args: { code: string; title: string; version: number; script: KitScript }): string {
  const { code, title, version, script } = args;
  const parts = [`${code} — ${title}`, `Script v${version}`];
  const blocks = BLOCKS.filter(([key]) => present(script[key]));
  if (blocks.length) {
    for (const [key, label] of blocks) parts.push(`${label}\n${(script[key] as string).trim()}`);
  } else if (present(script.raw_content)) {
    // A script the parser could not split.
    parts.push(`TESTO\n${script.raw_content.trim()}`);
  }
  if (present(script.notes)) parts.push(`NOTE\n${script.notes.trim()}`);
  return `${parts.join('\n\n')}\n`;
}

export function audioLinkText(args: { code: string; url: string }): string {
  return `${args.code} — audio approvato (consegnato come link)\n\n${args.url}\n`;
}
