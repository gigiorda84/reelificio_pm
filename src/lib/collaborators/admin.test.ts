import { describe, expect, it } from 'vitest';
import { parseCollaboratorsCsv, planImport, type ExistingProfile } from './admin';

const HEADER = 'email,full_name,external_kind,drive_email';

describe('parseCollaboratorsCsv', () => {
  it('reads rows, lowercases emails, keeps quoted commas', () => {
    const { rows, errors } = parseCollaboratorsCsv(
      `${HEADER}\nMario@Voci.it,"Rossi, Mario",dubber,mario.drive@gmail.com\nanna@x.it,Anna Bianchi,animator,\n`,
    );
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { email: 'mario@voci.it', full_name: 'Rossi, Mario', external_kind: 'dubber', drive_email: 'mario.drive@gmail.com' },
      { email: 'anna@x.it', full_name: 'Anna Bianchi', external_kind: 'animator', drive_email: null },
    ]);
  });

  it('skips blank and comment lines, keeping the file line numbers', () => {
    const { rows, errors } = parseCollaboratorsCsv(
      `# rivisto il 5/11\n${HEADER}\n\n# nota\nv@x.it,Val,validator,\nbad,B,dubber,\n`,
    );
    expect(rows.map((r) => r.email)).toEqual(['v@x.it']);
    expect(errors).toEqual(['line 6: bad email "bad"']);
  });

  it('reports every bad row with its line number', () => {
    const { rows, errors } = parseCollaboratorsCsv(
      `${HEADER}\nnot-an-email,A,dubber,\nb@x.it,,dubber,\nc@x.it,C,editor,\nd@x.it,D,dubber,bad\ne@x.it,E,dubber,\nE@x.it,E2,animator,\n`,
    );
    expect(rows.map((r) => r.email)).toEqual(['e@x.it']);
    expect(errors).toEqual([
      'line 2: bad email "not-an-email"',
      'line 3: full_name missing',
      'line 4: external_kind must be dubber|animator|validator',
      'line 5: bad drive_email "bad"',
      'line 7: duplicate email e@x.it',
    ]);
  });

  it('refuses a wrong header', () => {
    expect(parseCollaboratorsCsv('email,name\n').errors).toEqual([
      'header must be: email,full_name,external_kind,drive_email',
    ]);
  });
});

describe('planImport', () => {
  const row = (email: string) => ({ email, full_name: 'X', external_kind: 'dubber' as const, drive_email: null });
  const existing = new Map<string, ExistingProfile>([
    ['ext@x.it', { id: '1', email: 'ext@x.it', account_type: 'external', is_admin: false }],
    ['int@x.it', { id: '2', email: 'int@x.it', account_type: 'internal', is_admin: false }],
    ['adm@x.it', { id: '3', email: 'adm@x.it', account_type: 'internal', is_admin: true }],
  ]);

  it('creates new, updates externals, refuses internals by default', () => {
    const plan = planImport([row('new@x.it'), row('ext@x.it'), row('int@x.it')], existing, { convertExisting: false });
    expect(plan.map((p) => p.action)).toEqual(['create', 'update', 'refuse']);
  });

  it('converts a reviewed internal, never an admin', () => {
    const plan = planImport([row('int@x.it'), row('adm@x.it')], existing, { convertExisting: true });
    expect(plan.map((p) => p.action)).toEqual(['convert', 'refuse']);
  });
});
