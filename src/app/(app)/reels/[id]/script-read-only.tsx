'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { PencilLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { proposeTextChange } from '@/lib/tasks/actions';
import type { ReelDetail } from '@/lib/reels/queries';
import type { ProposalField } from '@/lib/tasks/queries';

type Props = {
  reel: ReelDetail;
  // From revisione on, whoever works on the reel proposes changes block by
  // block; the approver decides (the SQL checks who may propose).
  canPropose: boolean;
};

const FIELDS: ProposalField[] = ['hook', 'corpo', 'chiusura', 'cta'];

// The locked script (and the whole script for externals): read-only blocks,
// each with "Proponi modifica".
export function ScriptReadOnly({ reel, canPropose }: Props) {
  const t = useTranslations('reels.script');
  const tDetail = useTranslations('reels.detail');
  const hasBlocks = FIELDS.some((f) => reel[f]);

  return (
    <div className="max-w-3xl space-y-5">
      <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">{t('locked')}</p>
      {reel.parser_warning ? (
        <p className="text-xs text-muted-foreground">{tDetail('parserWarning')}</p>
      ) : null}
      {FIELDS.map((field) => (
        <Block key={field} reelId={reel.id} field={field} text={reel[field]} canPropose={canPropose} />
      ))}
      {!hasBlocks && reel.raw_content ? (
        <section className="space-y-1.5">
          <h3 className="text-sm font-medium">{t('rawContent')}</h3>
          <pre className="whitespace-pre-wrap rounded-md border bg-background/50 p-3 font-mono text-sm">
            {reel.raw_content}
          </pre>
        </section>
      ) : null}
      {reel.notes ? (
        <section className="space-y-1.5">
          <h3 className="text-sm font-medium">{t('notes')}</h3>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{reel.notes}</p>
        </section>
      ) : null}
    </div>
  );
}

function Block({
  reelId,
  field,
  text,
  canPropose,
}: {
  reelId: string;
  field: ProposalField;
  text: string | null;
  canPropose: boolean;
}) {
  const t = useTranslations('reels.script');
  const tTasks = useTranslations('tasks');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text ?? '');
  const [pending, startTransition] = useTransition();

  const submit = () => {
    startTransition(async () => {
      const result = await proposeTextChange(reelId, field, draft);
      if (result.ok) {
        toast.success(t('proposalSent'));
        setEditing(false);
      } else {
        toast.error(tTasks(`errors.${result.error}`));
      }
    });
  };

  return (
    <section className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{t(field)}</h3>
        {canPropose && !editing ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDraft(text ?? '');
              setEditing(true);
            }}
          >
            <PencilLine className="size-3.5" aria-hidden /> {t('propose')}
          </Button>
        ) : null}
      </div>
      {editing ? (
        <div className="space-y-2">
          <Textarea
            rows={field === 'corpo' ? 10 : 3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="font-mono"
            aria-label={t(field)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => setEditing(false)}>
              {t('cancel')}
            </Button>
            <Button size="sm" disabled={pending || draft === (text ?? '')} onClick={submit}>
              {t('sendProposal')}
            </Button>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-wrap rounded-md border bg-background px-3 py-2 font-mono text-sm">
          {text || <span className="text-muted-foreground">{t('empty')}</span>}
        </p>
      )}
    </section>
  );
}
