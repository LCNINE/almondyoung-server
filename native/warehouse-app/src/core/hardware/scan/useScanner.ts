import { useEffect, useRef } from 'react';
import { useScanBus, type ScanEvent } from './ScanProvider';

export function useScanner(handler: (e: ScanEvent) => void): void {
  const bus = useScanBus();
  useEffect(() => bus.subscribe(handler), [bus, handler]);
}

export function useScanEmit(): (e: ScanEvent) => void {
  return useScanBus().emit;
}

/** 일반 구독자보다 먼저 받는다(명령 스캔 제외). 피드백 테두리 지우기처럼 «이 스캔이 왔다» 만 아는 쪽용. */
export function useScanObserver(handler: (e: ScanEvent) => void): void {
  const bus = useScanBus();
  useEffect(() => bus.observe(handler), [bus, handler]);
}

/** 명령 바코드를 받는다 — 스테이션 셸만 건다. */
export function useCommandScans(handler: (code: string) => void): void {
  const bus = useScanBus();
  useEffect(() => bus.setCommandHandler(handler), [bus, handler]);
}

/**
 * 사람이 친 키(스펙 §5.6) — 스캐너 묶음과 그 끝 Enter 는 오지 않는다. 입력칸에 포커스가 있으면 입력칸이 받는다.
 * null 이면 구독하지 않는다. 핸들러는 렌더마다 새 함수여도 된다 — 다시 구독하지 않고 마지막 것을 부른다.
 */
export function useHumanKeys(handler: ((key: string) => void) | null): void {
  const bus = useScanBus();
  const latest = useRef(handler);
  latest.current = handler;
  const active = handler !== null;
  useEffect(() => {
    if (!active) return;
    return bus.subscribeKeys((key) => latest.current?.(key));
  }, [bus, active]);
}
