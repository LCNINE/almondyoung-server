/* oxlint-disable react/only-export-components -- Provider 와 use… 훅을 한 파일에서 내보내면 이 규칙은 항상 걸린다. 컨텍스트 둘을 모듈 밖에 노출하지 않으려고 한 파일로 둔다. */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { BatchProgress } from './statusBar';

const SetContext = createContext<((progress: BatchProgress | null) => void) | null>(null);
const ValueContext = createContext<BatchProgress | null>(null);

export function BatchProgressProvider({ children }: { children: ReactNode }) {
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  return (
    <SetContext.Provider value={setProgress}>
      <ValueContext.Provider value={progress}>{children}</ValueContext.Provider>
    </SetContext.Provider>
  );
}

/** F1·F2 화면이 지금 배치의 진행을 상태바에 올린다(스펙 §5.5). 화면이 사라지면 지운다. 셸 밖에선 아무 일도 안 한다. */
export function useBatchProgress(progress: BatchProgress | null): void {
  const set = useContext(SetContext);
  const code = progress?.code ?? null;
  const done = progress?.done ?? 0;
  const total = progress?.total ?? 0;
  useEffect(() => {
    set?.(code === null ? null : { code, done, total });
  }, [set, code, done, total]);
  useEffect(() => () => set?.(null), [set]);
}

export const useCurrentBatchProgress = (): BatchProgress | null => useContext(ValueContext);
