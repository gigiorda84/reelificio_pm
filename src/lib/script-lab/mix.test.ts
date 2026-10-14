import { describe, expect, it } from 'vitest';
import { composeMix, sameText, type VersionText } from './mix';

const a: VersionText = { id: 'a', model: 'm/alpha', hook: 'Hook A', corpo: 'Corpo A', chiusura: 'Chiusura A', cta: 'CTA A', notes: 'Regia A' };
const b: VersionText = { id: 'b', model: 'm/beta', hook: 'Hook B', corpo: 'Corpo B', chiusura: null, cta: 'CTA B', notes: 'Regia B' };

describe('composeMix', () => {
  it('takes every block from the base without picks', () => {
    const m = composeMix('a', {}, [a, b])!;
    expect(m.blocks).toEqual({ hook: 'Hook A', corpo: 'Corpo A', chiusura: 'Chiusura A', cta: 'CTA A' });
    expect(m.notes).toBe('Regia A');
    expect(m.sources).toEqual({ hook: 'a', corpo: 'a', chiusura: 'a', cta: 'a' });
    expect(m.overrides).toEqual({});
  });

  it('takes a block from another version and sends only that override', () => {
    const m = composeMix('a', { cta: 'b', hook: 'a' }, [a, b])!;
    expect(m.blocks.cta).toBe('CTA B');
    expect(m.blocks.hook).toBe('Hook A');
    expect(m.sources.cta).toBe('b');
    expect(m.overrides).toEqual({ cta: 'b' });
    expect(m.notes).toBe('Regia A');
  });

  it('copies an empty block as empty', () => {
    expect(composeMix('a', { chiusura: 'b' }, [a, b])!.blocks.chiusura).toBeNull();
  });

  it('refuses an unknown base or pick', () => {
    expect(composeMix('x', {}, [a, b])).toBeNull();
    expect(composeMix('a', { corpo: 'x' }, [a, b])).toBeNull();
  });
});

describe('sameText', () => {
  it('compares the four blocks and the notes, null and missing alike', () => {
    const m = composeMix('a', {}, [a, b])!;
    expect(sameText(m, a)).toBe(true);
    expect(sameText(m, { ...a, notes: null })).toBe(false);
    expect(sameText(composeMix('a', { cta: 'b' }, [a, b])!, a)).toBe(false);
  });
});
