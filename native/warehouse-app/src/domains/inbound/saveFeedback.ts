import {
  localStoragePrefs,
  type DevicePrefs,
} from '../../core/data/devicePrefs';
import {
  createSoundPlayer,
  defaultToneSink,
} from '../../station/feedback/soundPlayer';
import { readSoundPrefs } from '../../station/feedback/soundPrefs';
import savedChimeUrl from '../../assets/inbound-saved.mp3';

interface AudioLike {
  volume: number;
  currentTime: number;
  play(): Promise<void> | void;
}

export function createInboundSaveSound(deps: {
  createAudio: (src: string) => AudioLike | null;
  readPrefs: () => { volume: number; muted: boolean };
  errorPlayer: () => void;
  primeTones?: () => void;
}) {
  let audio: AudioLike | null | undefined;

  // 요소 하나를 만들어 재사용한다 — 저장마다 새로 만들면 제스처 밖에서 생성된다.
  const getAudio = () => {
    if (audio === undefined) {
      audio = deps.createAudio(savedChimeUrl);
    }

    return audio;
  };

  return {
    prime(): void {
      try {
        deps.primeTones?.();
        getAudio();
      } catch {
        // 준비 실패가 저장 흐름을 깨면 안 된다.
      }
    },
    saved(): void {
      try {
        const { volume, muted } = deps.readPrefs();

        if (muted || volume <= 0) {
          return;
        }

        const element = getAudio();

        if (!element) {
          return;
        }

        element.currentTime = 0;
        element.volume = volume / 100;

        // play() 거절(자동재생 정책)은 저장 흐름과 무관하다.
        void Promise.resolve(element.play()).catch(() => undefined);
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
  createAudio: (src) => {
    if (typeof Audio !== 'function') {
      return null;
    }

    const element = new Audio(src);
    element.preload = 'auto';

    return element;
  },
  readPrefs: () => readSoundPrefs(prefs),
  errorPlayer: () =>
    createSoundPlayer({
      sink: defaultToneSink(),
      readPrefs: () => readSoundPrefs(prefs),
    }).play('error'),
  primeTones: () => defaultToneSink()?.prime?.(),
});

export const primeInboundSaveSound = () => defaultSound.prime();
export const playInboundSaved = () => defaultSound.saved();
export const playInboundSaveFailed = () => defaultSound.failed();
