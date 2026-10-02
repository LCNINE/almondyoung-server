import { describe, expect, it } from 'vitest';
import { createMemoryPrefs } from '../../core/data/devicePrefs';
import { DEFAULT_SOUND_PREFS, SOUND_MUTED_KEY, SOUND_VOLUME_KEY, readSoundPrefs, writeSoundPrefs } from './soundPrefs';

describe('소리 설정', () => {
  it('저장된 게 없으면 기본값', () => {
    expect(readSoundPrefs(createMemoryPrefs())).toEqual(DEFAULT_SOUND_PREFS);
  });

  it.each([
    ['abc', DEFAULT_SOUND_PREFS.volume],
    ['', DEFAULT_SOUND_PREFS.volume],
    ['150', 100],
    ['-3', 0],
    ['42.6', 43],
  ])('저장값 %j → 음량 %i', (stored, volume) => {
    expect(readSoundPrefs(createMemoryPrefs({ [SOUND_VOLUME_KEY]: stored })).volume).toBe(volume);
  });

  it('왕복한다', () => {
    const prefs = createMemoryPrefs();
    writeSoundPrefs(prefs, { volume: 35, muted: true });
    expect(prefs.get(SOUND_MUTED_KEY)).toBe('1');
    expect(readSoundPrefs(prefs)).toEqual({ volume: 35, muted: true });
  });
});
