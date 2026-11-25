import { localStoragePrefs, type DevicePrefs } from '../../core/data/devicePrefs';
import { createSoundPlayer, defaultToneSink } from '../../station/feedback/soundPlayer';
import { readSoundPrefs } from '../../station/feedback/soundPrefs';
import savedChimeUrl from '../../assets/inbound-saved.mp3';

interface AudioLike {
  volume: number;
  play(): Promise<void> | void;
}

export function createInboundSaveSound(deps: {
  createAudio: (src: string) => AudioLike | null;
  readPrefs: () => { volume: number; muted: boolean };
  errorPlayer: () => void;
}) {
  return {
    saved(): void {
      try {
        const { volume, muted } = deps.readPrefs();

        if (muted || volume <= 0) {
          return;
        }

        const audio = deps.createAudio(savedChimeUrl);

        if (!audio) {
          return;
        }

        audio.volume = volume / 100;

        // play() 거절(자동재생 정책)은 저장 흐름과 무관하다.
        void Promise.resolve(audio.play()).catch(() => undefined);
      } catch {
        // 소리 실패가 저장 흐름을 깨면 안 된다.
      }
    },
    failed(): void {
      try {
        deps.errorPlayer();
      } catch {
        // 위와 같음.
      }
    },
  };
}

const prefs: DevicePrefs = localStoragePrefs;

const defaultSound = createInboundSaveSound({
  createAudio: (src) => (typeof Audio === 'function' ? new Audio(src) : null),
  readPrefs: () => readSoundPrefs(prefs),
  errorPlayer: () =>
    createSoundPlayer({ sink: defaultToneSink(), readPrefs: () => readSoundPrefs(prefs) }).play('error'),
});

export const playInboundSaved = () => defaultSound.saved();
export const playInboundSaveFailed = () => defaultSound.failed();
