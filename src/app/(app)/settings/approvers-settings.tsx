'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { saveApprovalGroup } from '@/lib/pages/actions';
import { setAbsence } from '@/lib/tasks/actions';
import type { ApprovalGroup } from '@/lib/pages/production';
import { formatRome } from '@/lib/dates';

export type InternalPerson = {
  id: string;
  label: string;
  absent_until: string | null;
  // absent_until is in the future (computed on the server).
  away: boolean;
};

type Props = {
  groups: ApprovalGroup[];
  people: InternalPerson[];
};

const SELECT_CLASS =
  'flex h-9 w-full rounded-md border bg-background px-3 py-1.5 text-sm shadow-xs outline-none focus-visible:ring-1 focus-visible:ring-ring';

// Admin only: approver and delegate of each group (one group, "Tutte le
// pagine", until groups are switched on) and absences. Setting an absence
// moves the person's open approvals to whoever approves in their place.
export function ApproversSettings({ groups, people }: Props) {
  const t = useTranslations('settings.approvers');
  const absent = people.filter((p) => p.away);

  return (
    <div className="space-y-8">
      {groups.map((g) => (
        <GroupForm key={g.id} group={g} people={people} showName={groups.length > 1} />
      ))}

      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-medium">{t('absenceTitle')}</h3>
          <p className="text-xs text-muted-foreground">{t('absenceHint')}</p>
        </div>
        {absent.length > 0 ? (
          <ul className="space-y-1.5 text-sm">
            {absent.map((p) => (
              <AbsentRow key={p.id} person={p} />
            ))}
          </ul>
        ) : null}
        <AbsenceForm people={people} />
      </div>
    </div>
  );
}

function GroupForm({ group, people, showName }: { group: ApprovalGroup; people: InternalPerson[]; showName: boolean }) {
  const t = useTranslations('settings.approvers');
  const [approver, setApprover] = useState(group.approver_id ?? '');
  const [delegate, setDelegate] = useState(group.delegate_id ?? '');
  const [pending, startTransition] = useTransition();

  const save = () => {
    startTransition(async () => {
      const result = await saveApprovalGroup(group.id, approver || null, delegate || null);
      if (result.ok) toast.success(t('saved'));
      else toast.error(t(`errors.${result.error}`));
    });
  };

  return (
    <div className="space-y-3">
      {showName ? <h3 className="text-sm font-medium">{group.name}</h3> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <PersonSelect id={`approver-${group.id}`} label={t('approver')} value={approver} onChange={setApprover} people={people} />
        <PersonSelect id={`delegate-${group.id}`} label={t('delegate')} value={delegate} onChange={setDelegate} people={people} />
      </div>
      <p className="text-xs text-muted-foreground">{t('groupHint')}</p>
      <Button disabled={pending} onClick={save}>
        {t('save')}
      </Button>
    </div>
  );
}

function AbsenceForm({ people }: { people: InternalPerson[] }) {
  const t = useTranslations('settings.approvers');
  const tTasks = useTranslations('tasks');
  const [person, setPerson] = useState('');
  const [until, setUntil] = useState('');
  const [pending, startTransition] = useTransition();

  const save = () => {
    if (!person || !until) return;
    startTransition(async () => {
      const result = await setAbsence(person, new Date(until).toISOString());
      if (result.ok) {
        toast.success(t('absenceSaved'));
        setPerson('');
        setUntil('');
      } else {
        toast.error(tTasks(`errors.${result.error}`));
      }
    });
  };

  return (
    <div className="grid items-end gap-3 md:grid-cols-[1fr_1fr_auto]">
      <PersonSelect id="absent-person" label={t('person')} value={person} onChange={setPerson} people={people} />
      <div className="space-y-1.5">
        <Label htmlFor="absent-until">{t('until')}</Label>
        <Input id="absent-until" type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} />
      </div>
      <Button disabled={pending || !person || !until} onClick={save}>
        {t('setAbsence')}
      </Button>
    </div>
  );
}

function AbsentRow({ person }: { person: InternalPerson }) {
  const t = useTranslations('settings.approvers');
  const tTasks = useTranslations('tasks');
  const [pending, startTransition] = useTransition();
  const back = () => {
    startTransition(async () => {
      const result = await setAbsence(person.id, null);
      if (result.ok) toast.success(t('backSaved'));
      else toast.error(tTasks(`errors.${result.error}`));
    });
  };
  return (
    <li className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
      <span>
        {t('absentUntil', {
          name: person.label,
          until: formatRome(person.absent_until!),
        })}
      </span>
      <Button variant="outline" size="sm" disabled={pending} onClick={back}>
        {t('back')}
      </Button>
    </li>
  );
}

function PersonSelect({
  id,
  label,
  value,
  onChange,
  people,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  people: InternalPerson[];
}) {
  const t = useTranslations('settings.approvers');
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select id={id} className={SELECT_CLASS} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t('nobody')}</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
    </div>
  );
}
