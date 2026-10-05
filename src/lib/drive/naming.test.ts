import { describe, expect, it } from 'vitest';
import {
  audioLinkFileName,
  batchFolderName,
  pageFolderName,
  reelFolderName,
  sanitizeName,
  scriptFileName,
  uploadedFileName,
  uploadExtension,
  uploadMimeType,
  audioContentType,
} from './naming';

describe('Drive names', () => {
  it('builds the folder chain of AC8', () => {
    expect(pageFolderName('PP', 'Porcino & Papaya')).toBe('PP — Porcino & Papaya');
    expect(batchFolderName('Batch Ottobre')).toBe('Batch Ottobre');
    expect(reelFolderName('TT-2611-01', 'Il porcino che parla')).toBe('TT-2611-01 — Il porcino che parla');
  });

  it('cleans slashes, emoji, typographic apostrophes and spaces', () => {
    expect(sanitizeName('L’ultimo / il “vero” 🍄  porcino\n')).toBe(`L'ultimo il "vero" porcino`);
    expect(sanitizeName('a\\b')).toBe('a b');
    expect(sanitizeName('👍🏽')).toBe('—');
  });

  it('cuts long titles on a character boundary', () => {
    const name = sanitizeName('è'.repeat(100), 10);
    expect(Array.from(name)).toHaveLength(10);
    expect(reelFolderName('PP-2610-01', 'x'.repeat(200))).toHaveLength('PP-2610-01 — '.length + 80);
  });

  it('names uploads and kit files with their version', () => {
    expect(uploadedFileName('TT-2611-01', 'audio', 2, 'WAV')).toBe('TT-2611-01_audio_v2.wav');
    expect(scriptFileName('TT-2611-01', 3)).toBe('TT-2611-01_script_v3.txt');
    expect(audioLinkFileName('TT-2611-01')).toBe('TT-2611-01_audio_link.txt');
  });

  it('takes the extension from the file, else from the MIME type', () => {
    expect(uploadExtension('take 3.WAV', 'audio/wav', 'audio')).toBe('wav');
    expect(uploadExtension('voce', 'audio/x-m4a', 'audio')).toBe('m4a');
    expect(uploadExtension('IMG_0001.MOV', '', 'video')).toBe('mov');
    expect(uploadExtension('clip', 'video/quicktime', 'video')).toBe('mov');
    expect(uploadExtension('clip.mp4', 'video/mp4', 'audio')).toBeNull();
    expect(uploadExtension('notes.txt', 'text/plain', 'audio')).toBeNull();
  });

  it('keeps the MIME type only when it matches the kind', () => {
    expect(uploadMimeType('Audio/WAV', 'audio')).toBe('audio/wav');
    expect(uploadMimeType('', 'video')).toBe('application/octet-stream');
    expect(uploadMimeType('video/mp4', 'audio')).toBe('application/octet-stream');
  });

  it('serves audio with a type the player understands', () => {
    expect(audioContentType('TT-2611-01_audio_v1.wav', 'application/octet-stream')).toBe('audio/wav');
    expect(audioContentType('TT-2611-01_audio_v2.m4a', 'audio/x-m4a')).toBe('audio/x-m4a');
    expect(audioContentType('x.bin', null)).toBe('application/octet-stream');
  });
});
