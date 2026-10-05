'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { savePageSla, updatePageProduction, type ProductionActionResult } from '@/lib/pages/actions';
import { ROLE_FIELDS, ROLE_KIND, type RoleField } from '@/lib/pages/production-constants';
import type { ApprovalGroup, PageProduction, SlaCell } from '@/lib/pages/production';
import type { AssignableProfile } from '@/lib/tasks/queries';

type Props = {
  pageId: string;
  initial: PageProduction;
  candidates: AssignableProfile[];
  sla: SlaCell[];
  groups: ApprovalGroup[];
  // Internals see the settings; only admins change them (RLS and SQL too).
  editable: boolean;
};

const SELECT_CLASS =
  'flex h-9 w-full rounded-md border bg-background px-3 py-1.5 text-sm shadow-xs outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60';

function hours(minutes: number | null): string {
  if (minutes === null) return '';
  return String(Math.round((minutes / 60) * 100) / 100);
}

export function ProductionSettings({ pageId, initial, candidates, sla, groups, editable }: Props) {
  const t = useTranslations('pages.production');
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<PageProduction>(initial);
  const [slaInput, setSlaInput] = useState<Record<string, string>>(() =>
    Object.fromEntries(sla.map((c) => [`${c.track}:${c.step}`, hours(c.pageMinutes)])),
  );

  const report = (result: ProductionActionResult) => {
    if (result.ok) toast.success(t('saved'));
    else toast.error(t(`errors.${result.error}`));
  };

  const saveRoles = () => {
    startTransition(async () => {
      const { approval_group_id, ...rest } = form;
      report(
        await updatePageProduction(pageId, {
          ...rest,
          ...(groups.length > 1 ? { approval_group_id } : {}),
        }),
      );
    });
  };

  const saveSla = () => {
    const changes: Parameters<typeof savePageSla>[1] = [];
    for (const cell of sla) {
      const raw = slaInput[`${cell.track}:${cell.step}`]?.trim().replace(',', '.') ?? '';
      const minutes = raw === '' ? null : Math.round(Number(raw) * 60);
      if (minutes !== null && !(minutes > 0)) {
        toast.error(t('errors.invalid_input'));
        return;
      }
      if (minutes !== cell.pageMinutes) changes.push({ track: cell.track, step: cell.step, minutes });
    }
    if (changes.length === 0) return;
    startTransition(async () => report(await savePageSla(pageId, changes)));
  };

  const fits = (field: RoleField, p: AssignableProfile) =>
    p.account_type === 'internal' || p.external_kind === ROLE_KIND[field];
  const label = (p: AssignableProfile) =>
    `${p.full_name?.trim() || p.email}${p.account_type === 'external' ? ` · ${t('external')}` : ''}`;

  return (
    <div className="space-y-8">
      <fieldset disabled={!editable || pending} className="space-y-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.requires_scientific_validation}
            onChange={(e) => setForm({ ...form, requires_scientific_validation: e.target.checked })}
          />
          {t('requiresValidation')}
        </label>
        <div className="grid gap-4 md:grid-cols-2">
          {ROLE_FIELDS.map((field) => (
            <div key={field} className="space-y-1.5">
              <Label htmlFor={field}>{t(`roles.${field}`)}</Label>
              <select
                id={field}
                className={SELECT_CLASS}
                value={form[field] ?? ''}
                onChange={(e) => setForm({ ...form, [field]: e.target.value || null })}
              >
                <option value="">{t('none')}</option>
                {candidates
                  .filter((p) => fits(field, p) || p.id === form[field])
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {label(p)}
                    </option>
                  ))}
              </select>
            </div>
          ))}
          {groups.length > 1 ? (
            <div className="space-y-1.5">
              <Label htmlFor="approval_group_id">{t('approvalGroup')}</Label>
              <select
                id="approval_group_id"
                className={SELECT_CLASS}
                value={form.approval_group_id ?? ''}
                onChange={(e) => setForm({ ...form, approval_group_id: e.target.value || null })}
              >
                <option value="">{t('defaultGroup')}</option>
                {groups
                  .filter((g) => !g.is_default)
                  .map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
              </select>
            </div>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">{t('rolesHint')}</p>
        {editable ? <Button onClick={saveRoles}>{t('save')}</Button> : null}
      </fieldset>

      <fieldset disabled={!editable || pending} className="space-y-3">
        <div>
          <h3 className="text-sm font-medium">{t('sla.title')}</h3>
          <p className="text-xs text-muted-foreground">{t('sla.hint')}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1.5 pr-3 font-normal">{t('sla.step')}</th>
                <th className="px-2 py-1.5 font-normal">{t('sla.batch')}</th>
                <th className="px-2 py-1.5 font-normal">{t('sla.express')}</th>
              </tr>
            </thead>
            <tbody>
              {sla
                .filter((c) => c.track === 'batch')
                .map((row) => (
                  <tr key={row.step} className="border-t">
                    <td className="py-1.5 pr-3">{t(`sla.steps.${row.step}`)}</td>
                    {(['batch', 'express'] as const).map((track) => {
                      const cell = sla.find((c) => c.track === track && c.step === row.step)!;
                      const key = `${track}:${row.step}`;
                      return (
                        <td key={track} className="px-2 py-1.5">
                          <Input
                            inputMode="decimal"
                            className="h-8 w-28"
                            value={slaInput[key] ?? ''}
                            placeholder={t('sla.default', { hours: hours(cell.defaultMinutes) })}
                            aria-label={`${t(`sla.steps.${row.step}`)} ${t(`sla.${track}`)}`}
                            onChange={(e) => setSlaInput({ ...slaInput, [key]: e.target.value })}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {editable ? <Button onClick={saveSla}>{t('sla.save')}</Button> : null}
      </fieldset>
    </div>
  );
}
