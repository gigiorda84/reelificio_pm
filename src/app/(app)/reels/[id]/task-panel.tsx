'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check, Undo2, X, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { ReelState } from '@/lib/reels/constants';
import {
  ACCEPT_KINDS,
  DECISION_KINDS,
  DELIVER_KINDS,
  SCRIPT_DECISION_KINDS,
} from '@/lib/tasks/constants';
import {
  acceptTask,
  assignTask,
  confirmMigratedTask,
  decideTask,
  declineTask,
  deliverTask,
  publishReel,
  scheduleReel,
  setReelTrack,
  type TaskActionResult,
} from '@/lib/tasks/actions';
import type { AssignableProfile, OpenTask } from '@/lib/tasks/queries';
import { semaforo, slaPercent } from '@/lib/tasks/semaforo';

type Props = {
  reelId: string;
  state: ReelState;
  track: 'batch' | 'express';
  scriptRev: number;
  caption: string | null;
  postedUrl: string | null;
  task: OpenTask | null;
  // The ?task=<id> of an email/Telegram link points to a task already closed.
  linkedTaskClosed: boolean;
  viewer: {
    userId: string | null;
    isAdmin: boolean;
    canDecide: boolean;
    canSetTrack: boolean;
    canPublish: boolean;
  };
  assignable: AssignableProfile[];
};

const LIGHT: Record<'green' | 'yellow' | 'red', string> = {
  green: 'bg-emerald-500',
  yellow: 'bg-amber-500',
  red: 'bg-red-500',
};

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) : '—';
}

export function TaskPanel({
  reelId,
  state,
  track,
  scriptRev,
  caption,
  postedUrl,
  task,
  linkedTaskClosed,
  viewer,
  assignable,
}: Props) {
  const t = useTranslations('tasks');
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState('');
  const [fileUrl, setFileUrl] = useState('');
  const [editingDone, setEditingDone] = useState(false);
  const [subtitles, setSubtitles] = useState(false);
  const [sendingBack, setSendingBack] = useState(false);
  const [sendBackTo, setSendBackTo] = useState<'animation' | 'dubbing'>('animation');
  const [assignee, setAssignee] = useState('');
  const [captionText, setCaptionText] = useState(caption ?? '');
  const [scheduledAt, setScheduledAt] = useState('');
  const [posted, setPosted] = useState('');

  const run = (fn: () => Promise<TaskActionResult>, done = 'done.ok') => {
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        toast.success(t(done));
        setNote('');
        setFileUrl('');
        setSendingBack(false);
      } else {
        toast.error(t(`errors.${result.error}`));
      }
    });
  };

  const isAssignee = !!task && !!viewer.userId && task.assignee_id === viewer.userId;
  const canAccept = !!task && isAssignee && task.status === 'assigned' && ACCEPT_KINDS.includes(task.kind);
  const canDeliver =
    !!task && task.status === 'in_progress' && DELIVER_KINDS.includes(task.kind) && (isAssignee || viewer.isAdmin);
  const canDecide = !!task && DECISION_KINDS.includes(task.kind) && viewer.canDecide;
  const canSchedule = !!task && task.kind === 'scheduling' && (isAssignee || viewer.isAdmin);
  const light = task ? semaforo({ startedAt: task.started_at, yellowAt: task.yellow_at, dueAt: task.due_at }) : null;
  const pct = task
    ? slaPercent({ startedAt: task.started_at, yellowAt: task.yellow_at, dueAt: task.due_at, escalateAt: task.escalate_at })
    : null;

  const noteField = (
    <div className="space-y-1">
      <Label htmlFor="task-note" className="text-xs">{t('panel.note')}</Label>
      <Textarea id="task-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
    </div>
  );

  return (
    <section id="task" className="w-full max-w-md space-y-3 rounded-lg border p-4 text-sm">
      {linkedTaskClosed ? (
        <p className="rounded-md bg-muted px-3 py-2 text-xs">{t('panel.closedTaskLink')}</p>
      ) : null}

      {!task ? (
        <div className="space-y-3">
          <p className="text-muted-foreground">
            {state === 'idea'
              ? t('panel.ideaHint')
              : state === 'programmato'
                ? t('panel.scheduledHint')
                : state === 'pubblicato'
                  ? t('panel.publishedHint')
                  : t('panel.noTask')}
          </p>
          {state === 'pubblicato' && postedUrl ? (
            <a href={postedUrl} target="_blank" rel="noreferrer" className="text-xs underline break-all">
              {postedUrl}
            </a>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{t('panel.title')}</p>
              <p className="font-medium">{t(`kind.${task.kind}`)}</p>
            </div>
            <div className="flex items-center gap-1.5">
              {track === 'express' ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800 dark:bg-red-950 dark:text-red-200">
                  <Zap className="size-3" aria-hidden /> {t('panel.express')}
                </span>
              ) : null}
              <span className="rounded-full border px-2 py-0.5 text-xs">{t(`status.${task.status}`)}</span>
            </div>
          </div>

          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">{t('panel.assignee')}</dt>
            <dd>{task.assignee_name ?? t('panel.nobody')}</dd>
            <dt className="text-muted-foreground">{t('panel.due')}</dt>
            <dd className="flex items-center gap-2">
              {light ? <span className={`inline-block size-2 rounded-full ${LIGHT[light]}`} aria-hidden /> : null}
              {fmt(task.due_at)}
              {pct !== null ? <span className="text-muted-foreground">· {t('panel.slaUsed', { pct })}</span> : null}
            </dd>
          </dl>

          {task.previous_note ? (
            <div className="rounded-md bg-amber-50 px-3 py-2 text-xs dark:bg-amber-950/30">
              <p className="font-medium">{t('panel.previousNote')}</p>
              <p className="whitespace-pre-wrap">{task.previous_note}</p>
            </div>
          ) : null}

          {task.origin === 'migration' && task.escalation_paused ? (
            <div className="space-y-2 rounded-md bg-muted px-3 py-2 text-xs">
              <p>{t('panel.migrated')}</p>
              {viewer.isAdmin ? (
                <Button size="sm" variant="outline" disabled={pending}
                  onClick={() => run(() => confirmMigratedTask(reelId, task.id))}>
                  {t('actions.confirmMigrated')}
                </Button>
              ) : null}
            </div>
          ) : null}

          {canAccept ? (
            <div className="space-y-2">
              {noteField}
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" disabled={pending}
                  onClick={() => run(() => declineTask(reelId, task.id, note))}>
                  <X className="size-3" aria-hidden /> {t('actions.decline')}
                </Button>
                <Button size="sm" disabled={pending} onClick={() => run(() => acceptTask(reelId, task.id))}>
                  <Check className="size-3" aria-hidden /> {t('actions.accept')}
                </Button>
              </div>
            </div>
          ) : null}

          {canDeliver ? (
            <div className="space-y-2">
              {task.kind !== 'writing' ? (
                <div className="space-y-1">
                  <Label htmlFor="task-file" className="text-xs">{t('panel.fileUrl')}</Label>
                  <Input id="task-file" type="url" inputMode="url" placeholder="https://"
                    value={fileUrl} onChange={(e) => setFileUrl(e.target.value)} />
                </div>
              ) : null}
              {task.kind === 'animation' ? (
                <div className="space-y-1 text-xs">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={editingDone} onChange={(e) => setEditingDone(e.target.checked)} />
                    {t('panel.editingDone')}
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={subtitles} onChange={(e) => setSubtitles(e.target.checked)} />
                    {t('panel.subtitles')}
                  </label>
                </div>
              ) : null}
              {noteField}
              <div className="flex justify-end">
                <Button size="sm" disabled={pending} onClick={() => run(() => deliverTask(reelId, task.id, {
                  fileUrl: task.kind === 'writing' ? undefined : fileUrl,
                  editingDone: task.kind === 'animation' ? editingDone : undefined,
                  subtitles: task.kind === 'animation' ? subtitles : undefined,
                  note,
                }))}>
                  {task.kind === 'writing' ? t('actions.deliverScript') : t('actions.deliver')}
                </Button>
              </div>
            </div>
          ) : null}

          {canDecide ? (
            <div className="space-y-2">
              {SCRIPT_DECISION_KINDS.includes(task.kind) ? (
                <p className="text-xs text-muted-foreground">{t('panel.scriptRev', { rev: scriptRev })}</p>
              ) : null}
              {noteField}
              {sendingBack && task.kind === 'final_approval' ? (
                <div className="space-y-1 text-xs">
                  <p className="text-muted-foreground">{t('panel.sendBackTo')}</p>
                  <label className="flex items-center gap-2">
                    <input type="radio" name="send-back-to" checked={sendBackTo === 'animation'}
                      onChange={() => setSendBackTo('animation')} />
                    {t('panel.toAnimation')}
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" name="send-back-to" checked={sendBackTo === 'dubbing'}
                      onChange={() => setSendBackTo('dubbing')} />
                    {t('panel.toDubbing')}
                  </label>
                </div>
              ) : null}
              <div className="flex justify-end gap-2">
                {sendingBack ? (
                  <>
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => setSendingBack(false)}>
                      <X className="size-3" aria-hidden />
                    </Button>
                    <Button size="sm" variant="outline" disabled={pending}
                      onClick={() => run(() => decideTask(reelId, task.id, {
                        decision: 'send_back',
                        note,
                        to: task.kind === 'final_approval' ? sendBackTo : undefined,
                      }))}>
                      <Undo2 className="size-3" aria-hidden /> {t('actions.confirmSendBack')}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => setSendingBack(true)}>
                      <Undo2 className="size-3" aria-hidden /> {t('actions.sendBack')}
                    </Button>
                    <Button size="sm" disabled={pending}
                      onClick={() => run(() => decideTask(reelId, task.id, {
                        decision: 'approve',
                        note,
                        expectedRev: SCRIPT_DECISION_KINDS.includes(task.kind) ? scriptRev : undefined,
                      }))}>
                      <Check className="size-3" aria-hidden /> {t('actions.approve')}
                    </Button>
                  </>
                )}
              </div>
            </div>
          ) : null}

          {canSchedule ? (
            <div className="space-y-2">
              <div className="space-y-1">
                <Label htmlFor="task-caption" className="text-xs">{t('panel.caption')}</Label>
                <Textarea id="task-caption" rows={3} maxLength={2200} value={captionText}
                  onChange={(e) => setCaptionText(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="task-when" className="text-xs">{t('panel.scheduledAt')}</Label>
                <Input id="task-when" type="datetime-local" value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)} />
              </div>
              <div className="flex justify-end">
                <Button size="sm" disabled={pending || !scheduledAt}
                  onClick={() => run(() => scheduleReel(reelId, captionText, new Date(scheduledAt).toISOString()))}>
                  {t('actions.schedule')}
                </Button>
              </div>
            </div>
          ) : null}

          {viewer.isAdmin ? (
            <div className="flex items-end gap-2 border-t pt-3">
              <div className="flex-1 space-y-1">
                <Label htmlFor="task-assign" className="text-xs">{t('panel.assignTo')}</Label>
                <select id="task-assign" value={assignee} onChange={(e) => setAssignee(e.target.value)}
                  className="h-8 w-full rounded-md border bg-background px-2 text-xs">
                  <option value="">{t('panel.chooseUser')}</option>
                  {assignable.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name ?? p.email}{p.external_kind ? ` · ${p.external_kind}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <Button size="sm" variant="outline" disabled={pending || !assignee}
                onClick={() => run(() => assignTask(reelId, task.id, assignee))}>
                {t('actions.assign')}
              </Button>
            </div>
          ) : null}
        </div>
      )}

      {viewer.canPublish && state === 'programmato' ? (
        <div className="flex items-end gap-2 border-t pt-3">
          <div className="flex-1 space-y-1">
            <Label htmlFor="task-posted" className="text-xs">{t('panel.postedUrl')}</Label>
            <Input id="task-posted" type="url" placeholder="https://www.instagram.com/p/…"
              value={posted} onChange={(e) => setPosted(e.target.value)} />
          </div>
          <Button size="sm" disabled={pending || !posted} onClick={() => run(() => publishReel(reelId, posted))}>
            {t('actions.publish')}
          </Button>
        </div>
      ) : null}

      {viewer.canSetTrack && !['programmato', 'pubblicato'].includes(state) ? (
        <div className="flex justify-end border-t pt-3">
          <Button size="sm" variant="ghost" disabled={pending}
            onClick={() => run(() => setReelTrack(reelId, track === 'express' ? 'batch' : 'express'))}>
            <Zap className="size-3" aria-hidden />
            {track === 'express' ? t('actions.setBatch') : t('actions.setExpress')}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
