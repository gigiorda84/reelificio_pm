import { describe, expect, it } from 'vitest';
import { audioLinkText, scriptKitText } from './kit';

const empty = { hook: null, corpo: null, chiusura: null, cta: null, raw_content: null, notes: null };

describe('kit files', () => {
  it('writes the blocks in order, skipping empty ones, then the notes', () => {
    const text = scriptKitText({
      code: 'TT-2611-01',
      title: 'Il porcino',
      version: 2,
      script: { ...empty, hook: ' Lo sapevi? ', corpo: 'Il porcino…', cta: '  ', notes: 'Tono ironico' },
    });
    expect(text).toBe('TT-2611-01 — Il porcino\n\nScript v2\n\nHOOK\nLo sapevi?\n\nCORPO\nIl porcino…\n\nNOTE\nTono ironico\n');
  });

  it('falls back to the raw text the parser could not split', () => {
    const text = scriptKitText({ code: 'TT-2611-02', title: 'x', version: 1, script: { ...empty, raw_content: 'Testo intero' } });
    expect(text).toContain('TESTO\nTesto intero');
  });

  it('writes the approved link of a legacy kit', () => {
    expect(audioLinkText({ code: 'TT-2611-03', url: 'https://wetransfer.com/x' })).toBe(
      'TT-2611-03 — audio approvato (consegnato come link)\n\nhttps://wetransfer.com/x\n',
    );
  });
});
