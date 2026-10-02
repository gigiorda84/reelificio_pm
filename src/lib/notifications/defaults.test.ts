import { describe, expect, it } from 'vitest';
import { DEFAULT_MATRIX, prefRowsToStore, type PrefMatrix } from './defaults';

function clone(m: PrefMatrix): PrefMatrix {
  return JSON.parse(JSON.stringify(m));
}

describe('prefRowsToStore', () => {
  it('stores nothing when the matrix equals the defaults', () => {
    expect(prefRowsToStore(clone(DEFAULT_MATRIX))).toEqual([]);
  });

  it('stores only the switches that differ', () => {
    const m = clone(DEFAULT_MATRIX);
    m.mention.telegram = true;
    m.weekly_digest.email = false;
    expect(prefRowsToStore(m)).toEqual([
      { event: 'mention', channel: 'telegram', enabled: true },
      { event: 'weekly_digest', channel: 'email', enabled: false },
    ]);
  });

  it('ignores whatsapp, which has no switch yet', () => {
    const m = clone(DEFAULT_MATRIX);
    m.mention.whatsapp = true;
    expect(prefRowsToStore(m)).toEqual([]);
  });
});
