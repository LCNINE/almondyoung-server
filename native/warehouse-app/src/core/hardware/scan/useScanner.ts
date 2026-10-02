import { useEffect } from 'react';
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
