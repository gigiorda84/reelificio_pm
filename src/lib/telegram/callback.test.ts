import { describe, expect, it } from 'vitest';
import { CALLBACK_MAX_BYTES, formatCallback, parseCallback } from './callback';

const TASK = '0f8b2c1e-1d2a-4c3b-9a8e-7f6d5c4b3a21';

describe('callback data', () => {
  it('round-trips with and without the revision', () => {
    expect(parseCallback(formatCallback({ op: 'apr', taskId: TASK, rev: 12 }))).toEqual({ op: 'apr', taskId: TASK, rev: 12 });
    expect(parseCallback(formatCallback({ op: 'acc', taskId: TASK, rev: null }))).toEqual({ op: 'acc', taskId: TASK, rev: null });
  });

  it('fits in 64 bytes with the longest op and a large revision', () => {
    expect(Buffer.byteLength(formatCallback({ op: 'rimc', taskId: TASK, rev: 999_999_999 }))).toBeLessThanOrEqual(CALLBACK_MAX_BYTES);
  });

  it('refuses unknown ops, bad ids, bad revisions and other versions', () => {
    expect(parseCallback(`v1:del:${TASK}`)).toBeNull();
    expect(parseCallback('v1:apr:not-a-uuid')).toBeNull();
    expect(parseCallback(`v1:apr:${TASK}:-1`)).toBeNull();
    expect(parseCallback(`v1:apr:${TASK}:1:2`)).toBeNull();
    expect(parseCallback(`v2:apr:${TASK}`)).toBeNull();
    expect(parseCallback('')).toBeNull();
  });
});
