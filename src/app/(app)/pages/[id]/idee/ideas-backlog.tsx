'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatRome } from '@/lib/dates';
import { saveIdea, setIdeaStatus, type IdeaActionResult } from '@/lib/ideas/actions';
import type { Idea, IdeasBatch, IdeaStatus } from '@/lib/ideas/queries';
import { CreateBatchDialog } from './create-batch-dialog';

type Props = {
  pageId: string;
  ideas: Idea[];
  counts: Record<IdeaStatus, number>;
  batches: IdeasBatch[];
  editable: boolean;
};

// Three tabs (AC5): the backlog, where ideas are added, edited, discarded and
// selected for a batch (numbered in the order they are ticked); the chosen
// ones with their reel; the discarded ones, which can come back. The tab
// counts are the real ones: the chosen list is capped.
export function IdeasBacklog({ pageId, ideas, counts, batches, editable }: Props) {
  const t = useTranslations('ideas');
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState('');
  const [spunto, setSpunto] = useState('');
  const [editing, setEditing] = useState<{ id: string; title: string; spunto: string } | null>(null);
  const [ticked, setTicked] = useState<string[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);

  const backlog = ideas.filter((i) => i.status === 'backlog');
  const chosen = ideas.filter((i) => i.status === 'scelta');
  const discarded = ideas.filter((i) => i.status === 'scartata');
  // Only ideas still in the backlog: one chosen or discarded elsewhere since
  // (another tab, another user) drops out after the refresh.
  const backlogIds = new Set(backlog.map((i) => i.id));
  const selected = ticked.filter((id) => backlogIds.has(id));

  const report = (result: IdeaActionResult, okMessage: string) => {
    if (result.ok) toast.success(okMessage);
    else toast.error(t(`errors.${result.error}`));
    return result.ok;
  };

  const add = () => {
    startTransition(async () => {
      if (report(await saveIdea(pageId, { id: null, title, spunto: spunto.trim() || null }), t('added'))) {
        setTitle('');
        setSpunto('');
      }
    });
  };
  const saveEdit = () => {
    if (!editing) return;
    startTransition(async () => {
      const result = await saveIdea(pageId, { id: editing.id, title: editing.title, spunto: editing.spunto.trim() || null });
      if (report(result, t('saved'))) setEditing(null);
    });
  };
  const move = (id: string, status: 'backlog' | 'scartata') => {
    startTransition(async () => {
      if (report(await setIdeaStatus(pageId, id, status), status === 'scartata' ? t('discarded') : t('restored'))) {
        setTicked((s) => s.filter((x) => x !== id));
      }
    });
  };
  const toggle = (id: string) => setTicked((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <>
      <Tabs defaultValue="backlog">
        <TabsList>
          <TabsTrigger value="backlog">{t('tabs.backlog', { count: counts.backlog })}</TabsTrigger>
          <TabsTrigger value="chosen">{t('tabs.chosen', { count: counts.scelta })}</TabsTrigger>
          <TabsTrigger value="discarded">{t('tabs.discarded', { count: counts.scartata })}</TabsTrigger>
        </TabsList>

        <TabsContent value="backlog" className="space-y-4 pt-4">
          {editable ? (
            <div className="space-y-2 rounded-lg border p-3">
              <Input
                aria-label={t('fields.title')}
                placeholder={t('fields.title')}
                maxLength={200}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <Textarea
                aria-label={t('fields.spunto')}
                placeholder={t('fields.spunto')}
                maxLength={2000}
                rows={2}
                value={spunto}
                onChange={(e) => setSpunto(e.target.value)}
              />
              <div className="flex justify-end">
                <Button type="button" size="sm" onClick={add} disabled={pending || title.trim() === ''}>
                  {t('add')}
                </Button>
              </div>
            </div>
          ) : null}

          {backlog.length === 0 ? <p className="text-sm text-muted-foreground">{t('emptyBacklog')}</p> : null}
          <ul className="divide-y rounded-lg border">
            {backlog.map((idea) => {
              const order = selected.indexOf(idea.id);
              return (
                <li key={idea.id} className="flex items-start gap-3 px-3 py-2">
                  {editable ? (
                    <label className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={order >= 0}
                        onChange={() => toggle(idea.id)}
                        aria-label={t('select', { title: idea.title })}
                      />
                      <span className="w-4 tabular-nums">{order >= 0 ? order + 1 : ''}</span>
                    </label>
                  ) : null}
                  {editing?.id === idea.id ? (
                    <div className="flex-1 space-y-2">
                      <Input
                        aria-label={t('fields.title')}
                        maxLength={200}
                        value={editing.title}
                        onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                      />
                      <Textarea
                        aria-label={t('fields.spunto')}
                        maxLength={2000}
                        rows={2}
                        value={editing.spunto}
                        onChange={(e) => setEditing({ ...editing, spunto: e.target.value })}
                      />
                      <div className="flex justify-end gap-2">
                        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
                          {t('cancel')}
                        </Button>
                        <Button type="button" size="sm" onClick={saveEdit} disabled={pending || editing.title.trim() === ''}>
                          {t('save')}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{idea.title}</p>
                      {idea.spunto ? <p className="whitespace-pre-wrap text-sm text-muted-foreground">{idea.spunto}</p> : null}
                    </div>
                  )}
                  {editable && editing?.id !== idea.id ? (
                    <div className="flex shrink-0 gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditing({ id: idea.id, title: idea.title, spunto: idea.spunto ?? '' })}
                      >
                        {t('edit')}
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => move(idea.id, 'scartata')} disabled={pending}>
                        {t('discard')}
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>

          {editable && selected.length > 0 ? (
            <div className="sticky bottom-4 flex items-center justify-between gap-3 rounded-lg border bg-background p-3 shadow-sm">
              <span className="text-sm">{t('selected', { count: selected.length })}</span>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="ghost" onClick={() => setTicked([])}>
                  {t('clear')}
                </Button>
                <Button type="button" size="sm" onClick={() => setDialogOpen(true)}>
                  {t('createBatch')}
                </Button>
              </div>
            </div>
          ) : null}
        </TabsContent>

        <TabsContent value="chosen" className="pt-4">
          {chosen.length === 0 ? <p className="text-sm text-muted-foreground">{t('emptyChosen')}</p> : null}
          <ul className="divide-y rounded-lg border">
            {chosen.map((idea) => (
              <li key={idea.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">{idea.source === 'doc' ? (idea.reel_title ?? idea.title) : idea.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {t(`source.${idea.source}`)}
                    {idea.decided_at ? ` · ${formatRome(idea.decided_at, { dateStyle: 'short' })}` : ''}
                  </p>
                </div>
                {idea.reel_id ? (
                  <Link href={`/reels/${idea.reel_id}`} className="shrink-0 font-mono text-xs underline">
                    {idea.reel_code}
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </TabsContent>

        <TabsContent value="discarded" className="pt-4">
          {discarded.length === 0 ? <p className="text-sm text-muted-foreground">{t('emptyDiscarded')}</p> : null}
          <ul className="divide-y rounded-lg border">
            {discarded.map((idea) => (
              <li key={idea.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">{idea.title}</p>
                  {idea.spunto ? <p className="text-muted-foreground">{idea.spunto}</p> : null}
                </div>
                {editable ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => move(idea.id, 'backlog')} disabled={pending}>
                    {t('restore')}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </TabsContent>
      </Tabs>

      {editable ? (
        <CreateBatchDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          pageId={pageId}
          ideaIds={selected}
          batches={batches}
        />
      ) : null}
    </>
  );
}
