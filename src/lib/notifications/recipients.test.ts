import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import {
  internalProfiles,
  isActiveInternal,
  mentionRecipients,
  taskGrantsVisibility,
  type ProfileLike,
} from './recipients';

function clientReturning(rows: ProfileLike[]): SupabaseClient {
  return {
    from: () => ({ select: async () => ({ data: rows, error: null }) }),
  } as unknown as SupabaseClient;
}

describe('isActiveInternal', () => {
  it('treats a profile without the Fase 1 columns as internal', () => {
    expect(isActiveInternal({ id: 'a' })).toBe(true);
  });

  it('excludes externals and deactivated profiles', () => {
    expect(isActiveInternal({ id: 'a', account_type: 'internal' })).toBe(true);
    expect(isActiveInternal({ id: 'b', account_type: 'external' })).toBe(false);
    expect(
      isActiveInternal({ id: 'c', account_type: 'internal', deactivated_at: '2026-10-01T00:00:00Z' }),
    ).toBe(false);
  });
});

describe('internalProfiles', () => {
  it('keeps every profile before the migration (no columns)', async () => {
    const rows = [{ id: 'a' }, { id: 'b' }];
    expect((await internalProfiles(clientReturning(rows))).map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('drops externals and deactivated profiles after the migration', async () => {
    const rows: ProfileLike[] = [
      { id: 'a', account_type: 'internal', deactivated_at: null },
      { id: 'b', account_type: 'external', deactivated_at: null },
      { id: 'c', account_type: 'internal', deactivated_at: '2026-10-01T00:00:00Z' },
    ];
    expect((await internalProfiles(clientReturning(rows))).map((p) => p.id)).toEqual(['a']);
  });

  it('fails loudly instead of broadcasting to nobody silently', async () => {
    const failing = {
      from: () => ({ select: async () => ({ data: null, error: { message: 'boom' } }) }),
    } as unknown as SupabaseClient;
    await expect(internalProfiles(failing)).rejects.toThrow('boom');
  });
});

describe('mentionRecipients', () => {
  const internal: ProfileLike = { id: 'int', account_type: 'internal' };
  const legacy: ProfileLike = { id: 'old' }; // before the migration
  const extSees: ProfileLike = { id: 'ext1', account_type: 'external' };
  const extBlind: ProfileLike = { id: 'ext2', account_type: 'external' };
  const sees = new Set(['ext1']);

  it('skips the author and deactivated profiles', () => {
    const gone: ProfileLike = { id: 'gone', account_type: 'internal', deactivated_at: '2026-10-01' };
    expect(
      mentionRecipients({
        authorId: 'int',
        mentioned: [internal, gone, legacy],
        internalOnly: false,
        externalsWhoSeeTarget: sees,
      }),
    ).toEqual(['old']);
  });

  it('notifies an external only when they can see the reel', () => {
    expect(
      mentionRecipients({
        authorId: 'x',
        mentioned: [internal, extSees, extBlind],
        internalOnly: false,
        externalsWhoSeeTarget: sees,
      }),
    ).toEqual(['int', 'ext1']);
  });

  it('never notifies an external from an internal-only comment', () => {
    expect(
      mentionRecipients({
        authorId: 'x',
        mentioned: [internal, extSees],
        internalOnly: true,
        externalsWhoSeeTarget: sees,
      }),
    ).toEqual(['int']);
  });

  it('drops externals entirely when nobody sees the target (fase1-pre-r1)', () => {
    expect(
      mentionRecipients({
        authorId: 'x',
        mentioned: [legacy, extSees],
        internalOnly: false,
        externalsWhoSeeTarget: new Set(),
      }),
    ).toEqual(['old']);
  });
});

describe('taskGrantsVisibility', () => {
  const now = new Date('2026-10-20T12:00:00Z');
  const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 3600 * 1000).toISOString();

  it('open tasks always grant visibility', () => {
    for (const status of ['unassigned', 'assigned', 'in_progress']) {
      expect(taskGrantsVisibility({ assignee_id: 'x', status, closed_at: null }, now)).toBe(true);
    }
  });

  it('outcomes grant it for 7 days', () => {
    expect(taskGrantsVisibility({ assignee_id: 'x', status: 'delivered', closed_at: daysAgo(6.9) }, now)).toBe(true);
    expect(taskGrantsVisibility({ assignee_id: 'x', status: 'sent_back', closed_at: daysAgo(7) }, now)).toBe(false);
  });

  it('declined, expired and cancelled never do', () => {
    for (const status of ['declined', 'expired', 'cancelled']) {
      expect(taskGrantsVisibility({ assignee_id: 'x', status, closed_at: daysAgo(0) }, now)).toBe(false);
    }
  });
});
