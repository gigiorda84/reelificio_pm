'use client';

import { useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  ALL_PIPELINE_PHASES,
  RACI_ROLES,
  type PipelinePhase,
  type RaciRole,
} from '@/lib/reels/constants';
import { saveRaciSnapshot, type RaciSnapshot } from '@/lib/raci/actions';
import type { RaciRow } from '@/lib/raci/queries';
import type { ProfileLite } from '@/lib/profiles/queries';

type Props = {
  pageId: string;
  profiles: ProfileLite[];
  initial: RaciRow[];
};

function toSnapshot(rows: RaciRow[]): RaciSnapshot {
  const out = {} as RaciSnapshot;
  for (const phase of ALL_PIPELINE_PHASES) {
    const row = rows.find((r) => r.phase === phase);
    out[phase] = {
      responsible: row?.responsible ?? [],
      approver: row?.approver ?? [],
      consulted: row?.consulted ?? [],
      informed: row?.informed ?? [],
    };
  }
  return out;
}

export function RaciEditor({ pageId, profiles, initial }: Props) {
  const tPhase = useTranslations('batches.reel.phase');
  const tRaci = useTranslations('raci');
  const tCommon = useTranslations('common');
  const [snapshot, setSnapshot] = useState<RaciSnapshot>(() => toSnapshot(initial));
  const [pending, startTransition] = useTransition();

  const profileLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of profiles) m.set(p.id, p.full_name || p.email);
    return m;
  }, [profiles]);

  const toggle = (phase: PipelinePhase, role: RaciRole, userId: string) => {
    setSnapshot((prev) => {
      const list = new Set(prev[phase][role]);
      if (list.has(userId)) list.delete(userId);
      else list.add(userId);
      return {
        ...prev,
        [phase]: { ...prev[phase], [role]: Array.from(list) },
      };
    });
  };

  const save = () => {
    startTransition(async () => {
      const result = await saveRaciSnapshot(pageId, snapshot);
      if (result.ok) toast.success(tRaci('saved'));
      else if (result.error === 'not_admin') toast.error(tRaci('errors.notAdmin'));
      else toast.error(result.message ?? tCommon('error'));
    });
  };

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2 font-medium">{tRaci('columnPhase')}</th>
              {RACI_ROLES.map((role) => (
                <th key={role} className="px-3 py-2 font-medium">
                  {tRaci(`role.${role}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ALL_PIPELINE_PHASES.map((phase) => (
              <tr key={phase} className="border-t align-top">
                <td className="px-3 py-3 font-medium whitespace-nowrap">
                  {tPhase(phase)}
                </td>
                {RACI_ROLES.map((role) => {
                  const selected = snapshot[phase][role];
                  return (
                    <td key={role} className="px-3 py-3 min-w-[14rem]">
                      <div className="flex flex-wrap gap-1 mb-2">
                        {selected.length === 0 ? (
                          <span className="text-xs text-muted-foreground">
                            {tRaci('noOne')}
                          </span>
                        ) : (
                          selected.map((id) => (
                            <span
                              key={id}
                              className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs"
                            >
                              {profileLabel.get(id) ?? id}
                              <button
                                type="button"
                                onClick={() => toggle(phase, role, id)}
                                className="text-muted-foreground hover:text-foreground"
                                aria-label={tCommon('delete')}
                              >
                                ×
                              </button>
                            </span>
                          ))
                        )}
                      </div>
                      <select
                        value=""
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v) toggle(phase, role, v);
                        }}
                        className="h-7 w-full rounded-md border bg-background px-2 text-xs shadow-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        <option value="">{tRaci('addUser')}</option>
                        {profiles
                          .filter((p) => !selected.includes(p.id))
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.full_name || p.email}
                            </option>
                          ))}
                      </select>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end">
        <Button onClick={save} disabled={pending}>
          {pending ? tCommon('saving') : tCommon('save')}
        </Button>
      </div>
    </div>
  );
}
