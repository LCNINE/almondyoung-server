import type { DevicePrefs } from '../../core/data/devicePrefs';

export const SOUND_VOLUME_KEY = 'almondwms.station.soundVolume';
export const SOUND_MUTED_KEY = 'almondwms.station.soundMuted';

export interface SoundPrefs {
  /** 0~100 */
  volume: number;
  muted: boolean;
}

export const DEFAULT_SOUND_PREFS: SoundPrefs = { volume: 80, muted: false };

const clampVolume = (n: number) => Math.min(100, Math.max(0, Math.round(n)));

export function readSoundPrefs(prefs: DevicePrefs): SoundPrefs {
  const stored = prefs.get(SOUND_VOLUME_KEY);
  const n = stored === null || stored.trim() === '' ? Number.NaN : Number(stored);
  return {
    volume: Number.isFinite(n) ? clampVolume(n) : DEFAULT_SOUND_PREFS.volume,
    muted: prefs.get(SOUND_MUTED_KEY) === '1',
  };
}

export function writeSoundPrefs(prefs: DevicePrefs, next: SoundPrefs): void {
  prefs.set(SOUND_VOLUME_KEY, String(clampVolume(next.volume)));
  prefs.set(SOUND_MUTED_KEY, next.muted ? '1' : '0');
}
