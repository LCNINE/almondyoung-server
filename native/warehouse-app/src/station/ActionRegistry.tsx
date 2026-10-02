/* oxlint-disable react/only-export-components -- Provider 와 use… 훅을 한 파일에서 내보내면 이 규칙은 항상 걸린다(src/app/session-context.tsx·warehouse-context.tsx 도 같은 경고를 낸다). 컨텍스트를 모듈 밖에 노출하지 않으려고 한 파일로 둔다. */
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  actionsSignature,
  assertUniqueKeys,
  dispatchKey,
  resolveActions,
  type KeyDispatch,
  type StationAction,
} from './actions';
import type { StationKey } from './keys';

export interface RegistryApi {
  register(layerId: number, actions: readonly StationAction[]): void;
  unregister(layerId: number): void;
  setDigitHandler(layerId: number, handler: ((digit: number) => void) | null): void;
  /** 이벤트 처리기용 — 렌더와 무관하게 마지막 등록(최신 `run`)으로 판정한다. */
  resolveKey(key: StationKey): KeyDispatch;
  digitHandler(): ((digit: number) => void) | null;
}

const ApiContext = createContext<RegistryApi | null>(null);
/** 표시용 — `run` 이 낡았을 수 있다(서명 불변이면 갱신 안 함). 실행은 `RegistryApi.resolveKey`. */
const ResolvedContext = createContext<ReadonlyMap<StationKey, StationAction>>(new Map());

let nextLayerId = 0;
/**
 * 층 순서 = 첫 렌더 순서. 부모가 자식보다 먼저 렌더되므로 셸 < 화면이다.
 * (effect 는 자식이 먼저 돌아서 등록 순서로는 층을 정할 수 없다.)
 */
function useLayerId(): number {
  const [id] = useState(() => ++nextLayerId);
  return id;
}

function ordered<T>(map: ReadonlyMap<number, T>): T[] {
  return [...map.entries()].sort(([a], [b]) => a - b).map(([, value]) => value);
}

export function ActionRegistryProvider({ children }: { children: ReactNode }) {
  const layers = useRef(new Map<number, readonly StationAction[]>());
  const digits = useRef(new Map<number, (digit: number) => void>());
  const [resolved, setResolved] = useState<ReadonlyMap<StationKey, StationAction>>(() => new Map());

  const api = useMemo<RegistryApi>(() => {
    const current = () => resolveActions(ordered(layers.current));
    return {
      register(layerId, actions) {
        assertUniqueKeys(actions);
        const previous = layers.current.get(layerId);
        layers.current.set(layerId, actions);
        // 렌더마다 새 배열·새 run 이 와도 그리는 값이 같으면 다시 알리지 않는다 — 알리면 바가 매 렌더 다시 그려지고,
        // 등록하는 쪽이 바를 구독하면 무한 렌더가 된다. run 은 resolveKey 가 늘 최신 등록에서 꺼낸다.
        if (!previous || actionsSignature(previous) !== actionsSignature(actions)) setResolved(current());
      },
      unregister(layerId) {
        layers.current.delete(layerId);
        digits.current.delete(layerId);
        setResolved(current());
      },
      setDigitHandler(layerId, handler) {
        if (handler) digits.current.set(layerId, handler);
        else digits.current.delete(layerId);
      },
      resolveKey: (key) => dispatchKey(current(), key),
      digitHandler: () => ordered(digits.current).at(-1) ?? null,
    };
  }, []);

  return (
    <ApiContext.Provider value={api}>
      <ResolvedContext.Provider value={resolved}>{children}</ResolvedContext.Provider>
    </ApiContext.Provider>
  );
}

/**
 * 화면이 지금 상태의 액션을 선언한다(스펙 §5.2). 셸 밖(핸드헬드)에서는 아무 일도 하지 않으므로 공유 화면에서 불러도 된다.
 * 렌더마다 새 배열이어도 된다 — 그리는 값(id·key·label·enabled)이 같으면 바를 다시 그리지 않고 `run` 만 최신이 된다.
 */
export function useStationActions(actions: readonly StationAction[]): void {
  const api = useContext(ApiContext);
  const layerId = useLayerId();
  useEffect(() => {
    api?.register(layerId, actions);
  }, [api, layerId, actions]);
  useEffect(() => () => api?.unregister(layerId), [api, layerId]);
}

/** 숫자 명령(`%91%N`)을 받을 곳 — 「수량」 입력 중인 화면만 건다(스펙 §5.3). 가장 안쪽 하나만 받는다. */
export function useDigitCommands(handler: ((digit: number) => void) | null): void {
  const api = useContext(ApiContext);
  const layerId = useLayerId();
  useEffect(() => {
    api?.setDigitHandler(layerId, handler);
    return () => api?.setDigitHandler(layerId, null);
  }, [api, layerId, handler]);
}

export function useRegistryApi(): RegistryApi | null {
  return useContext(ApiContext);
}

/**
 * 기능키 바가 «그릴» 맵 — 표시용(id·key·label·enabled)이다. 서명이 바뀔 때만 갱신되므로 여기 든 `run` 은 낡았을 수 있다.
 * 실행은 반드시 `useRegistryApi().resolveKey(key)` 로 한다(늘 최신 `run`).
 */
export function useResolvedActions(): ReadonlyMap<StationKey, StationAction> {
  return useContext(ResolvedContext);
}
