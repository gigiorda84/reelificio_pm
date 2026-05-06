// Dumps a Drive doc to tests/fixtures/<slug>.txt for parser regression tests.
//   pnpm exec tsx scripts/dump-drive-fixture.ts <fileId-or-url> <slug>
import { config } from 'dotenv';
import { writeFileSync } from 'node:fs';
import { fetchDocAsText } from '../src/lib/drive/fetch';

config({ path: '.env.local' });

async function main() {
  const fileArg = process.argv[2];
  const slug = process.argv[3] ?? 'doc';
  if (!fileArg) {
    console.error('Usage: tsx scripts/dump-drive-fixture.ts <fileId> <slug>');
    process.exit(1);
  }
  const result = await fetchDocAsText(fileArg);
  const path = `tests/fixtures/${slug}.txt`;
  writeFileSync(path, result.text, 'utf8');
  console.log(`Wrote ${path} (${result.text.length} chars)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
