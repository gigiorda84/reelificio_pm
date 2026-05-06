// Runs the parser against tests/fixtures/porcino-papaya-may.txt and prints
// per-reel results plus aggregate stats. Use this as a quick regression
// check after parser changes.
//   pnpm exec tsx scripts/test-parser.ts
import { readFileSync } from 'node:fs';
import { parseScriptDoc } from '../src/lib/parser/parse';

const FIXTURE = 'tests/fixtures/porcino-papaya-may.txt';

const text = readFileSync(FIXTURE, 'utf8');
const parsed = parseScriptDoc(text);

console.log('Page name :', parsed.pageName);
console.log('Batch     :', parsed.batchLabel);
console.log('Warnings  :', parsed.warnings.length, parsed.warnings);
console.log('Reels     :', parsed.reels.length);
console.log('---');

const formats = new Map<string, number>();
let withWarnings = 0;
let missingHook = 0;
let missingCorpo = 0;
let missingChiusura = 0;
let missingCta = 0;
let withNotes = 0;

for (const reel of parsed.reels) {
  formats.set(reel.format, (formats.get(reel.format) ?? 0) + 1);
  if (reel.parserWarning) withWarnings++;
  if (!reel.hook) missingHook++;
  if (!reel.corpo) missingCorpo++;
  if (!reel.chiusura) missingChiusura++;
  if (!reel.cta) missingCta++;
  if (reel.notes) withNotes++;

  console.log(
    `#${String(reel.ordinal).padStart(2)} ${reel.format.padEnd(18)} ${reel.title}`,
  );
  if (reel.parserWarning) console.log('     ! ', reel.parserWarning);
  if (reel.notes) console.log('     note:', reel.notes.slice(0, 80) + '…');
}

console.log('---');
console.log('Format counts:', Object.fromEntries(formats));
console.log('Reels with parser fallback:', withWarnings);
console.log('Missing HOOK    :', missingHook);
console.log('Missing CORPO   :', missingCorpo);
console.log('Missing CHIUSURA:', missingChiusura);
console.log('Missing CTA     :', missingCta);
console.log('Reels w/ notes  :', withNotes);

const ok =
  parsed.pageName &&
  parsed.batchLabel &&
  parsed.reels.length === 20 &&
  withWarnings === 0 &&
  missingHook === 0 &&
  missingCorpo === 0;

if (!ok) {
  console.error('\nPARSER REGRESSION');
  process.exit(1);
}
console.log('\nOK');
