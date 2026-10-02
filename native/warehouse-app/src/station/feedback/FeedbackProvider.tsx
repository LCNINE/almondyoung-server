/* oxlint-disable react/only-export-components -- Provider 와 use… 훅을 한 파일에서 내보내면 이 규칙은 항상 걸린다. 컨텍스트를 모듈 밖에 노출하지 않으려고 한 파일로 둔다. */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { localStoragePrefs, type DevicePrefs } from '../../core/data/devicePrefs';
import { useScanObserver } from '../../core/hardware/scan/useScanner';
import { createSoundPlayer, defaultToneSink, type ToneSink } from './soundPlayer';
import { readSoundPrefs } from './soundPrefs';
import type { FeedbackKind } from './tones';

export type Flash = 'error' | 'complete' | null;

interface FeedbackApi {
  signal(kind: FeedbackKind): void;
}

const SignalContext = createContext<FeedbackApi>({ signal: () => {} });
const FlashContext = createContext<Flash>(null);

/**
 * 스캔 결과를 화면을 안 보고도 알게 한다(스펙 §5.4): 소리 넷 + 화면 테두리(오류 빨강·완료 초록).
 * 테두리는 다음 스캔에서 사라진다 — 버스의 observe 로 일반 구독자보다 먼저 지우므로, 화면이 그 스캔을
 * 처리하며 낸 오류는 남는다. 명령 스캔은 버스가 따로 보내므로 셸이 signal('command') 로 지운다.
 */
export function FeedbackProvider({
  prefs = localStoragePrefs,
  sink,
  children,
}: {
  prefs?: DevicePrefs;
  /** 생략하면 Web Audio, null 이면 무음(테스트). */
  sink?: ToneSink | null;
  children: ReactNode;
}) {
  const [flash, setFlash] = useState<Flash>(null);
  const api = useMemo<FeedbackApi>(() => {
    const player = createSoundPlayer({
      sink: sink === undefined ? defaultToneSink() : sink,
      readPrefs: () => readSoundPrefs(prefs),
    });
    return {
      signal(kind) {
        player.play(kind);
        setFlash(kind === 'error' ? 'error' : kind === 'complete' ? 'complete' : null);
      },
    };
  }, [sink, prefs]);
  useScanObserver(useCallback(() => setFlash(null), []));
  return (
    <SignalContext.Provider value={api}>
      <FlashContext.Provider value={flash}>{children}</FlashContext.Provider>
    </SignalContext.Provider>
  );
}

/** 셸 밖(핸드헬드)에서는 아무 일도 하지 않는다 — 공유 화면이 불러도 된다. */
export const useFeedback = (): FeedbackApi => useContext(SignalContext);
export const useFlash = (): Flash => useContext(FlashContext);
