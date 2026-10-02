// Semaforo of a task, from the thresholds `add_sla()` stores on the task in
// SQL: `yellow_at` (75% of the SLA), `due_at` (100%), `escalate_at` (150%).
// Batch SLAs skip weekends, so the thresholds are not evenly spaced in wall
// time; everything here reads them as anchors and never recomputes the SLA.

export type Semaforo = 'green' | 'yellow' | 'red';

type Instant = string | Date | null | undefined;

export type TaskThresholds = {
  startedAt: Instant;
  yellowAt: Instant;
  dueAt: Instant;
  escalateAt?: Instant;
};

function ms(value: Instant): number | null {
  if (value == null) return null;
  const t = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

// null = the task has no SLA (legacy or unassigned): show no light.
export function semaforo(task: TaskThresholds, now: Date = new Date()): Semaforo | null {
  const yellow = ms(task.yellowAt);
  const due = ms(task.dueAt);
  if (yellow === null || due === null) return null;
  const t = now.getTime();
  if (t >= due) return 'red';
  if (t >= yellow) return 'yellow';
  return 'green';
}

// Share of the SLA used, as a whole percentage for the task card: 75 at
// `yellow_at`, 100 at `due_at`, 150 at `escalate_at`. Linear between those
// anchors, and past the last one at the slope of the last segment.
export function slaPercent(task: TaskThresholds, now: Date = new Date()): number | null {
  const start = ms(task.startedAt);
  const yellow = ms(task.yellowAt);
  const due = ms(task.dueAt);
  if (start === null || yellow === null || due === null) return null;

  const anchors: Array<[number, number]> = [
    [start, 0],
    [yellow, 75],
    [due, 100],
  ];
  const escalate = ms(task.escalateAt);
  if (escalate !== null) anchors.push([escalate, 150]);

  const t = now.getTime();
  if (t <= start) return 0;

  for (let i = 1; i < anchors.length; i++) {
    const [t0, p0] = anchors[i - 1];
    const [t1, p1] = anchors[i];
    if (t <= t1 || i === anchors.length - 1) {
      if (t1 <= t0) return t >= t1 ? p1 : p0;
      return Math.round(p0 + ((t - t0) / (t1 - t0)) * (p1 - p0));
    }
  }
  return null;
}
