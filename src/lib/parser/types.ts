// Domain enum equivalents — mirror the Postgres enums so the parser output
// can flow straight into a DB insert without conversion.

export type ParsedReelFormat =
  | 'porcino_mono'
  | 'papaya_mono'
  | 'botta_e_risposta'
  | 'duo'
  | 'other';

export type ParsedReel = {
  ordinal: number;
  title: string;
  format: ParsedReelFormat;
  formatTag: string | null;     // raw tag line, useful for UI / debugging
  hook: string | null;
  corpo: string | null;
  chiusura: string | null;
  cta: string | null;
  notes: string | null;
  rawContent: string | null;    // populated only when parser couldn't decompose
  parserWarning: string | null; // human-readable reason
};

export type ParsedDoc = {
  pageName: string | null;       // e.g. "PORCINO & PAPAYA"
  batchLabel: string | null;     // e.g. "Batch Maggio"
  reels: ParsedReel[];
  warnings: string[];
};
