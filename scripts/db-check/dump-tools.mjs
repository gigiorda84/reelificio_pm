// Helpers for rehearse-dump.sh (docs/fase1-plan.md §S1).
//
//   node dump-tools.mjs filter-data <data.sql> <out.sql>
//     Keeps the INSERTs of schema public and of auth.users (redirected to the
//     staging table rehearse_stage.auth_users, created from the column list
//     in the dump's own INSERT header, I10) and the setval of public
//     sequences. Drops every other auth table (identities, sessions,
//     refresh_tokens, flow_state, one_time_tokens, mfa_amr_claims, …), psql
//     meta-commands and SETs. Loads with triggers off (replica role).
//
//   node dump-tools.mjs normalize-schema <schema.sql>
//     One statement per line, whitespace collapsed, comments, SETs and
//     \restrict lines removed, sorted: two schema dumps compare with diff.

import { readFileSync, writeFileSync } from 'node:fs';

// Splits SQL into statements at `;`, outside quotes, dollar quotes and
// comments. Lines starting with a backslash (psql meta-commands) are dropped.
export function splitStatements(sql) {
  const text = sql
    .split('\n')
    .filter((l) => !l.startsWith('\\'))
    .join('\n');
  const out = [];
  let cur = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '-' && next === '-') {
      const end = text.indexOf('\n', i);
      i = end < 0 ? text.length : end + 1;
      cur += '\n';
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 2;
      continue;
    }
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === ch && text[j + 1] === ch) j += 2;
        else if (text[j] === ch) break;
        else j++;
      }
      cur += text.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (ch === '$') {
      const m = /^\$[A-Za-z_]*\$/.exec(text.slice(i));
      if (m) {
        const tag = m[0];
        const end = text.indexOf(tag, i + tag.length);
        const stop = end < 0 ? text.length : end + tag.length;
        cur += text.slice(i, stop);
        i = stop;
        continue;
      }
    }
    if (ch === ';') {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      i++;
      continue;
    }
    cur += ch;
    i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function filterData(inPath, outPath) {
  const statements = splitStatements(readFileSync(inPath, 'utf8'));
  const kept = [];
  let authColumns = null;
  const dropped = new Map();
  for (const s of statements) {
    const head = /^INSERT INTO "([^"]+)"\."([^"]+)"\s*\(([^)]*)\)/.exec(s);
    if (head) {
      const [, schema, table, cols] = head;
      if (schema === 'public') {
        kept.push(s);
      } else if (schema === 'auth' && table === 'users') {
        authColumns = cols.split(',').map((c) => c.trim());
        kept.push(s.replace(/^INSERT INTO "auth"\."users"/, 'INSERT INTO "rehearse_stage"."auth_users"'));
      } else {
        dropped.set(`${schema}.${table}`, (dropped.get(`${schema}.${table}`) ?? 0) + 1);
      }
      continue;
    }
    if (/^SELECT pg_catalog\.setval\('"public"\./.test(s)) kept.push(s);
  }
  if (!authColumns) throw new Error('no INSERT INTO "auth"."users" in the dump');

  const header = [
    'create schema if not exists rehearse_stage;',
    `create table rehearse_stage.auth_users (${authColumns.map((c) => `${c} text`).join(', ')});`,
    'set session_replication_role = replica;',
  ];
  const footer = ['set session_replication_role = origin;'];
  writeFileSync(outPath, [...header, ...kept.map((s) => `${s};`), ...footer].join('\n') + '\n');
  console.log(
    `filter-data: kept ${kept.length} statements; auth.users with ${authColumns.length} columns; ` +
      `dropped ${[...dropped.keys()].join(', ') || 'nothing'}`,
  );
}

export function normalizeSchema(sql) {
  const lines = new Set();
  for (const s of splitStatements(sql)) {
    const flat = s.replace(/\s+/g, ' ').trim();
    if (!flat) continue;
    if (/^(SET|RESET) /i.test(flat)) continue;
    if (/^SELECT pg_catalog\.set_config\(/i.test(flat)) continue;
    lines.add(flat);
  }
  return [...lines].sort();
}

const [cmd, a, b] = process.argv.slice(2);
if (cmd === 'filter-data') filterData(a, b);
else if (cmd === 'normalize-schema') process.stdout.write(normalizeSchema(readFileSync(a, 'utf8')).join('\n') + '\n');
else if (cmd) {
  console.error('usage: dump-tools.mjs filter-data <in> <out> | normalize-schema <in>');
  process.exit(1);
}
