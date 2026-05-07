'use client';

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { useTranslations } from 'next-intl';
import type { ProfileLite } from '@/lib/profiles/queries';

export type MentionTextareaHandle = {
  reset: (body?: string, mentions?: string[]) => void;
};

type Props = {
  name: string;
  profiles: ProfileLite[];
  initialBody?: string;
  initialMentions?: string[];
  rows?: number;
  required?: boolean;
  onChange?: (body: string, mentionIds: string[]) => void;
};

const MENTION_TRIGGER = /(?:^|\s)@([\p{L}0-9._-]*)$/u;

function displayLabel(p: ProfileLite): string {
  return p.full_name?.trim() || p.email;
}

function reconcileMentions(
  body: string,
  current: { id: string; label: string }[],
): { id: string; label: string }[] {
  return current.filter((m) => body.includes(`@${m.label}`));
}

export const MentionTextarea = forwardRef<MentionTextareaHandle, Props>(
  function MentionTextarea(
    { name, profiles, initialBody = '', initialMentions = [], rows = 3, required, onChange },
    ref,
  ) {
    const t = useTranslations('comments');
    const taRef = useRef<HTMLTextAreaElement>(null);
    const [body, setBody] = useState(initialBody);
    const [mentions, setMentions] = useState<{ id: string; label: string }[]>(() => {
      const byId = new Map(profiles.map((p) => [p.id, displayLabel(p)] as const));
      return initialMentions
        .map((id) => ({ id, label: byId.get(id) ?? '' }))
        .filter((m) => m.label.length > 0);
    });
    const [trigger, setTrigger] = useState<{ start: number; query: string } | null>(null);
    const [activeIdx, setActiveIdx] = useState(0);

    useImperativeHandle(
      ref,
      () => ({
        reset: (newBody = '', newMentionIds = []) => {
          const byId = new Map(profiles.map((p) => [p.id, displayLabel(p)] as const));
          setBody(newBody);
          setMentions(
            newMentionIds
              .map((id) => ({ id, label: byId.get(id) ?? '' }))
              .filter((m) => m.label.length > 0),
          );
          setTrigger(null);
        },
      }),
      [profiles],
    );

    useEffect(() => {
      onChange?.(body, mentions.map((m) => m.id));
    }, [body, mentions, onChange]);

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      const caret = e.target.selectionStart ?? value.length;
      setBody(value);
      setMentions((prev) => reconcileMentions(value, prev));

      const upToCaret = value.slice(0, caret);
      const match = MENTION_TRIGGER.exec(upToCaret);
      if (match) {
        setTrigger({ start: caret - match[1].length - 1, query: match[1] });
        setActiveIdx(0);
      } else {
        setTrigger(null);
      }
    };

    const filtered = trigger
      ? profiles
          .filter((p) => {
            if (!trigger.query) return true;
            const q = trigger.query.toLowerCase();
            return (
              displayLabel(p).toLowerCase().includes(q) ||
              p.email.toLowerCase().includes(q)
            );
          })
          .slice(0, 6)
      : [];

    const insertMention = (p: ProfileLite) => {
      if (!trigger || !taRef.current) return;
      const label = displayLabel(p);
      const before = body.slice(0, trigger.start);
      const after = body.slice(taRef.current.selectionStart ?? body.length);
      const inserted = `@${label} `;
      const next = before + inserted + after;
      setBody(next);
      setMentions((prev) => {
        const merged = [...prev.filter((m) => m.id !== p.id), { id: p.id, label }];
        return reconcileMentions(next, merged);
      });
      setTrigger(null);

      requestAnimationFrame(() => {
        if (!taRef.current) return;
        const pos = before.length + inserted.length;
        taRef.current.focus();
        taRef.current.setSelectionRange(pos, pos);
      });
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (!trigger || filtered.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => (i + 1) % filtered.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => (i - 1 + filtered.length) % filtered.length);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(filtered[activeIdx]);
      } else if (e.key === 'Escape') {
        setTrigger(null);
      }
    };

    return (
      <div className="relative">
        <textarea
          ref={taRef}
          name={name}
          rows={rows}
          required={required}
          value={body}
          placeholder={t('writePlaceholder')}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={() => setTimeout(() => setTrigger(null), 120)}
          className="flex w-full rounded-md border bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        {mentions.map((m) => (
          <input key={m.id} type="hidden" name="mentions" value={m.id} />
        ))}

        {trigger && filtered.length > 0 ? (
          <ul className="absolute z-20 left-0 right-0 mt-1 max-h-56 overflow-auto rounded-md border bg-popover text-popover-foreground shadow-md">
            {filtered.map((p, idx) => (
              <li key={p.id}>
                <button
                  type="button"
                  onMouseDown={(ev) => {
                    ev.preventDefault();
                    insertMention(p);
                  }}
                  onMouseEnter={() => setActiveIdx(idx)}
                  className={
                    'w-full text-left px-3 py-1.5 text-sm flex flex-col ' +
                    (idx === activeIdx ? 'bg-accent text-accent-foreground' : '')
                  }
                >
                  <span className="font-medium">{displayLabel(p)}</span>
                  {p.full_name ? (
                    <span className="text-xs text-muted-foreground">{p.email}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : trigger ? (
          <p className="absolute z-20 left-0 right-0 mt-1 rounded-md border bg-popover px-3 py-2 text-xs text-muted-foreground shadow-md">
            {t('mentionEmpty')}
          </p>
        ) : null}
      </div>
    );
  },
);
