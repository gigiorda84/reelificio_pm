import { describe, expect, it } from 'vitest';
import { formatStandup, isStandupTime, worthSendingOnWeekend, TELEGRAM_LIMIT, type StandupItem, type StandupSnapshot } from './format';

const item = (n: number, over: Partial<StandupItem> = {}): StandupItem => ({
  task_id: `t${n}`,
  reel_id: `r${n}`,
  code: `TT-2611-${String(n).padStart(2, '0')}`,
  title: `Reel <${n}>`,
  kind: 'animation',
  status: 'in_progress',
  due_at: '2026-10-20T16:00:00Z',
  express: false,
  assignee_name: 'Ada',
  ...over,
});
const healthy = { sweep_last_run: '2026-10-20T06:25:00Z', sweep_age_minutes: 5, oldest_job_minutes: 0, dead_letters_24h: 0, violations: 0, sweep_errors: 0 };
const snap = (over: Partial<StandupSnapshot> = {}): StandupSnapshot => ({
  late: [], due_today: [], unassigned: [], health: healthy, ...over,
});
const run = (s: StandupSnapshot) => formatStandup({ snapshot: s, dayLabel: 'mar 20/10', appUrl: 'https://app.reelificio.com' });

describe('formatStandup', () => {
  it('lists late before due today before to assign, keeping the SQL order (Express first)', () => {
    const out = run(snap({
      late: [item(1, { express: true }), item(2)],
      due_today: [item(3)],
      unassigned: [item(4, { status: 'unassigned', assignee_name: null })],
    }));
    expect(out.indexOf('In ritardo (2)')).toBeLessThan(out.indexOf('Consegne di oggi (1)'));
    expect(out.indexOf('Consegne di oggi (1)')).toBeLessThan(out.indexOf('Da assegnare (1)'));
    expect(out.indexOf('⚡ <code>TT-2611-01</code>')).toBeLessThan(out.indexOf('TT-2611-02'));
    expect(out).toContain('Reel &lt;1&gt;');
    expect(out).toContain('https://app.reelificio.com/compiti');
  });

  it('says when there is nothing, with no health line if all is well', () => {
    const out = run(snap());
    expect(out).toContain('Niente in ritardo');
    expect(out).not.toContain('⚙️');
  });

  it('adds the health line when something is wrong', () => {
    const out = run(snap({ health: { ...healthy, sweep_age_minutes: 45, dead_letters_24h: 2, violations: 1 } }));
    expect(out).toContain('lo sweep non gira da 45 min');
    expect(out).toContain('2 messaggi non consegnati');
    expect(out).toContain('1 reel in uno stato incoerente');
  });

  it('stays within 4096 characters and counts what it left out', () => {
    const many = Array.from({ length: 200 }, (_, i) => item(i, { title: 'Titolo piuttosto lungo per riempire la riga '.repeat(2) }));
    const out = run(snap({ late: many, health: { ...healthy, violations: 3 } }));
    expect(out.length).toBeLessThanOrEqual(TELEGRAM_LIMIT);
    expect(out).toMatch(/\+\d+ altri — apri l’app/);
    expect(out).toContain('3 reel in uno stato incoerente');
  });
});

describe('worthSendingOnWeekend', () => {
  it('only with late work or Express items', () => {
    expect(worthSendingOnWeekend(snap({ due_today: [item(1)] }))).toBe(false);
    expect(worthSendingOnWeekend(snap({ due_today: [item(1, { express: true })] }))).toBe(true);
    expect(worthSendingOnWeekend(snap({ late: [item(1)] }))).toBe(true);
  });
});

describe('isStandupTime', () => {
  it('fires at 08:30 Rome, whichever of the two UTC runs that is', () => {
    expect(isStandupTime(new Date('2026-10-20T06:30:00Z'))).toBe(true); // CEST
    expect(isStandupTime(new Date('2026-10-20T07:30:00Z'))).toBe(false); // 09:30 CEST
    expect(isStandupTime(new Date('2026-11-03T07:30:00Z'))).toBe(true); // CET
    expect(isStandupTime(new Date('2026-11-03T06:30:00Z'))).toBe(false); // 07:30 CET
    expect(isStandupTime(new Date('2026-11-03T07:41:00Z'))).toBe(false);
  });
});
