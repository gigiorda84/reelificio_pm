// Quick local sanity check for the Drive service account.
//   pnpm exec tsx scripts/test-drive-fetch.ts <fileId-or-url>
import { config } from 'dotenv';
import { fetchDocAsText } from '../src/lib/drive/fetch';

config({ path: '.env.local' });

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: tsx scripts/test-drive-fetch.ts <fileId-or-url>');
    process.exit(1);
  }
  const result = await fetchDocAsText(arg);
  console.log('Name:', result.name);
  console.log('FileId:', result.fileId);
  console.log('ModifiedTime:', result.modifiedTime);
  console.log('RevisionId:', result.revisionId);
  console.log('Length:', result.text.length, 'chars');
  console.log('--- First 600 chars ---');
  console.log(result.text.slice(0, 600));
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
