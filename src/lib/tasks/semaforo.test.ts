import { describe, expect, it } from 'vitest';
import { semaforo, slaPercent, type TaskThresholds } from './semaforo';

const SEC = 1000;
const HOUR = 3600 * SEC;

// A 24 h Express task started at 10:00 UTC: yellow at 18 h, due at 24 h,
// escalation at 36 h.
const start = Date.parse('2026-10-05T10:00:00Z');
const task: TaskThresholds = {
  startedAt: new Date(start).toISOString(),
  yellowAt: new Date(start + 18 * HOUR).toISOString(),
  dueAt: new Date(start + 24 * HOUR).toISOString(),
  escalateAt: new Date(start + 36 * HOUR).toISOString(),
};
const at = (offset: number) => new Date(start + offset);

describe('semaforo', () => {
  it('is green until one second before yellow_at', () => {
    expect(semaforo(task, at(0))).toBe('green');
    expect(semaforo(task, at(18 * HOUR - SEC))).toBe('green');
  });

  it('turns yellow exactly at yellow_at', () => {
    expect(semaforo(task, at(18 * HOUR))).toBe('yellow');
    expect(semaforo(task, at(24 * HOUR - SEC))).toBe('yellow');
  });

  it('turns red exactly at due_at and stays red', () => {
    expect(semaforo(task, at(24 * HOUR))).toBe('red');
    expect(semaforo(task, at(100 * HOUR))).toBe('red');
  });

  it('shows no light for a task without thresholds (legacy)', () => {
    expect(semaforo({ startedAt: null, yellowAt: null, dueAt: null }, at(0))).toBeNull();
    expect(semaforo({ ...task, dueAt: null }, at(0))).toBeNull();
  });

  it('accepts Date thresholds', () => {
    const asDates: TaskThresholds = {
      startedAt: new Date(start),
      yellowAt: new Date(start + 18 * HOUR),
      dueAt: new Date(start + 24 * HOUR),
    };
    expect(semaforo(asDates, at(20 * HOUR))).toBe('yellow');
  });
});

describe('slaPercent', () => {
  it('maps the anchors to 0, 75, 100 and 150', () => {
    expect(slaPercent(task, at(0))).toBe(0);
    expect(slaPercent(task, at(18 * HOUR))).toBe(75);
    expect(slaPercent(task, at(24 * HOUR))).toBe(100);
    expect(slaPercent(task, at(36 * HOUR))).toBe(150);
  });

  it('is linear inside each segment', () => {
    expect(slaPercent(task, at(9 * HOUR))).toBe(38); // 37.5 rounded
    expect(slaPercent(task, at(21 * HOUR))).toBe(88); // 87.5 rounded
    expect(slaPercent(task, at(30 * HOUR))).toBe(125);
  });

  it('keeps growing after escalate_at', () => {
    expect(slaPercent(task, at(48 * HOUR))).toBe(200);
  });

  it('follows uneven Batch anchors instead of wall time', () => {
    // Friday 18:00 → due Monday 18:00 (weekend skipped); yellow Monday 12:00.
    const fri = Date.parse('2026-10-09T16:00:00Z');
    const batch: TaskThresholds = {
      startedAt: new Date(fri).toISOString(),
      yellowAt: new Date(fri + 66 * HOUR).toISOString(),
      dueAt: new Date(fri + 72 * HOUR).toISOString(),
    };
    expect(semaforo(batch, new Date(fri + 66 * HOUR))).toBe('yellow');
    expect(slaPercent(batch, new Date(fri + 66 * HOUR))).toBe(75);
    // Without escalate_at the last segment's slope continues past due.
    expect(slaPercent(batch, new Date(fri + 78 * HOUR))).toBe(125);
  });

  it('is 0 before the start and null without thresholds', () => {
    expect(slaPercent(task, at(-HOUR))).toBe(0);
    expect(slaPercent({ ...task, startedAt: null }, at(0))).toBeNull();
  });
});
