import { describe, expect, it } from 'vitest';
import { safeNextPath } from './redirect';

describe('safeNextPath', () => {
  it('keeps a same-origin path', () => {
    expect(safeNextPath('/reels/abc?task=1')).toBe('/reels/abc?task=1');
  });

  it('sends everything else to /compiti', () => {
    for (const raw of [null, '', 'compiti', '//evil.example', 'https://evil.example', '/a b', '/\\evil.example', '/x\\y']) {
      expect(safeNextPath(raw)).toBe('/compiti');
    }
  });
});
