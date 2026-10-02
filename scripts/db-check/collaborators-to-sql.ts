// For rehearse-dump.sh: turns the reviewed collaborators.csv into SQL calls,
// parsed by the same code as scripts/fase1-collaborators.ts, so the rehearsal
// reads the CSV exactly as release step 6b will.
//   pnpm exec tsx scripts/db-check/collaborators-to-sql.ts <csv>
import { readFileSync } from 'node:fs';
import { parseCollaboratorsCsv } from '../../src/lib/collaborators/admin';

const lit = (v: string | null) => (v === null ? 'null' : `'${v.replace(/'/g, "''")}'`);

const path = process.argv[2];
if (!path) {
  console.error('usage: collaborators-to-sql.ts <csv>');
  process.exit(1);
}
const { rows, errors } = parseCollaboratorsCsv(readFileSync(path, 'utf8'));
if (errors.length) {
  console.error(`${path}:\n  ${errors.join('\n  ')}`);
  process.exit(1);
}
for (const r of rows) {
  console.log(
    `select rehearse_stage.add_external(${lit(r.email)}, ${lit(r.full_name)}, ` +
      `${lit(r.external_kind)}, ${lit(r.drive_email)});`,
  );
}
