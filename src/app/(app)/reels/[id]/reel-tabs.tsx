'use client';

import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { Tabs } from '@/components/ui/tabs';

// The reel's tabs, controlled so that another part of the page (the task
// panel's "N avvisi" link, Fase 2 S5) can open a tab and scroll to a section
// in it: inactive panels are not rendered, so a plain #anchor would not work.
export const SHOW_EVENT = 'reel:show';
export type ShowDetail = { tab: string; anchor?: string };

export function showReelSection(detail: ShowDetail) {
  window.dispatchEvent(new CustomEvent<ShowDetail>(SHOW_EVENT, { detail }));
}

export function ReelTabs({ defaultValue, children }: { defaultValue: string; children: React.ReactNode }) {
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    const onShow = (e: Event) => {
      const { tab, anchor } = (e as CustomEvent<ShowDetail>).detail;
      // Render the panel now, so the anchor exists when we scroll to it.
      flushSync(() => setValue(tab));
      if (anchor) document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    window.addEventListener(SHOW_EVENT, onShow);
    return () => window.removeEventListener(SHOW_EVENT, onShow);
  }, []);

  return (
    <Tabs value={value} onValueChange={(v) => setValue(String(v))}>
      {children}
    </Tabs>
  );
}
