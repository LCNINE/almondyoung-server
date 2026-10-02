import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '../../core/data/errorMessage';
import { ApiError } from '../../core/data/httpClient';
import { useWorkScanQueue } from '../../core/hardware/scan/useWorkScanQueue';
import { useWorkAreaBlocked } from '../../core/operations/WorkBoundary';
import { progressOf, scannedLineOf } from '../../domains/outbound/inspection';
import { useForceSimpleOutbound, useSimpleOutboundScan } from '../../domains/outbound/mutations';
import type { ShipmentByWaybill, SimpleOutboundLineProgress, SimpleOutboundState } from '../../domains/outbound/types';

/** 스테이션 강제출고의 고정 사유(스펙 §7.4) — 서버는 강제하지 않는다. 사후 점검이 이 문자열로 거른다 */
export const STATION_FORCE_REASON = 'station_force_command';
/** 스테이션 박스 빼기(F11)의 고정 사유 — 강제출고와 같은 꼴(계획이 정함) */
export const STATION_WITHDRAW_REASON = 'station_withdraw_command';
export const INTAKE_BLOCKED_MESSAGE = '앞 스캔을 확인하고 있어요. 확인이 끝난 뒤 다시 찍어 주세요.';
export const UNCERTAIN_SCAN_MESSAGE = '앞 스캔이 처리됐는지 확인하지 못했어요. 같은 상품을 다시 찍지 마세요.';

export interface InspectionBoxEvents {
  /** 서버가 반영한 스캔 — 오른 줄(못 찾으면 null)과 수량 */
  onAccepted(shipmentLineId: string | null, quantity: number): void;
  /** 마지막 스캔(또는 강제출고)으로 출고됐다 */
  onShipped(): void;
  /** 서버가 거절했거나 결과를 모른다 — 화면이 오류로 알린다 */
  onRejected(message: string, barcode: string | null): void;
  /** 출고 뒤에 줄 서 있던 스캔 — 보내지 않았다 */
  onExcess(): void;
}

/**
 * 박스 하나의 출고 검수(스펙 §6.3). 상품 스캔은 «저장 → 서버 한 트랜잭션(준비·피킹·검수·마지막이면 출고, §6.1)» 이고,
 * 지금의 복구 장치를 그대로 쓴다: 저장된 스캔은 다시 열면 원래 키로 재생되고(useWorkScanQueue), 결과를 모르는 스캔이 있으면
 * 입력을 막는다(WorkBoundary). 큐가 박스에 묶이도록 쓰는 쪽이 박스마다 컴포넌트를 새로 마운트한다(`key`).
 */
export function useInspectionBox(box: ShipmentByWaybill, events: InspectionBoxEvents) {
  const scan = useSimpleOutboundScan();
  const force = useForceSimpleOutbound();
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const [progress, setProgress] = useState<SimpleOutboundLineProgress[]>(() => progressOf(box));
  const progressRef = useRef(progress);
  const [workItemStatus, setWorkItemStatus] = useState(box.workItemStatus ?? 'queued');
  const [lastScan, setLastScan] = useState<{ barcode: string; shipmentLineId: string } | null>(null);
  const shipped = useRef(false);

  /** 서버 응답을 그린다. 출고됐으면 알리고 true */
  const apply = (state: SimpleOutboundState): boolean => {
    progressRef.current = state.lines;
    setProgress(state.lines);
    setWorkItemStatus(state.workItemStatus);
    if (state.status !== 'shipped') return false;
    shipped.current = true;
    eventsRef.current.onShipped();
    return true;
  };

  const queue = useWorkScanQueue<{ barcode: string; quantity: number }>(async (input, id) => {
    if (shipped.current) {
      eventsRef.current.onExcess();
      return;
    }
    try {
      const state = await scan.mutateAsync({ shipmentId: box.shipmentId, ...input, idempotencyKey: id });
      const line = scannedLineOf(progressRef.current, state.lines);
      if (line) setLastScan({ barcode: input.barcode, shipmentLineId: line });
      if (!apply(state)) eventsRef.current.onAccepted(line, input.quantity);
    } catch (error) {
      const rejected = error instanceof ApiError && error.outcome === 'rejected';
      eventsRef.current.onRejected(rejected ? errorMessage(error, 'outbound') : UNCERTAIN_SCAN_MESSAGE, input.barcode);
      // 확정된 거절만 큐에서 뺀다 — 결과를 모르는 스캔은 머리에 남겨 같은 키로 다시 맞춘다
      if (!rejected) throw error;
    }
  }, `outbound:${box.shipmentId}`);

  const areaBlocked = useWorkAreaBlocked('outbound', {
    path: `/shipments/${box.shipmentId}/simple-outbound-scans`,
    operationId: queue.head()?.id,
  });
  const intakeBlocked = !queue.ready || !!queue.error() || areaBlocked || force.isPending;

  // settle 을 기다리는 쪽(내려놓기·전환). 결과를 모르는 단순출고 스캔은 실행기의 약속이 풀리지 않은 채 머물러
  // 큐의 drain 이 끝나지 않는다 — 그래서 «비었다» 와 «확인 못 한 것이 생겼다» 를 렌더마다 직접 본다.
  const waiters = useRef<Array<{ resolve: () => void; reject: (error: Error) => void }>>([]);
  const unsettled = !queue.ready || !!queue.error() || areaBlocked;
  useEffect(() => {
    if (waiters.current.length === 0) return;
    if (unsettled) waiters.current.splice(0).forEach((w) => w.reject(new Error(UNCERTAIN_SCAN_MESSAGE)));
    else if (queue.size() === 0) waiters.current.splice(0).forEach((w) => w.resolve());
  });

  return {
    progress,
    workItemStatus,
    lastScan,
    intakeBlocked,
    /** 보낼 것이 없고 받을 수 있다 — 결품·전량·강제출고·박스 빼기는 이때만 */
    idle: !intakeBlocked && queue.size() === 0,
    forcing: force.isPending,
    queueError: queue.error(),
    storageError: queue.storageError(),
    /** 상품 하나(수량 n). 받을 수 없으면 false — 화면이 오류로 알린다 */
    accept(barcode: string, quantity: number): boolean {
      if (intakeBlocked || shipped.current) return false;
      queue.enqueue({ barcode, quantity });
      return true;
    },
    /**
     * 앞 스캔이 다 보내질 때까지 기다린다 — 내려놓기·전환 전에(U13). 확인 못 한 스캔이 있거나 기다리는 사이 생기면
     * 기다리지 않고 거절한다(UNCERTAIN_SCAN_MESSAGE). 크기는 렌더 값이 아니라 지금 값을 본다 — 같은 틱의 accept 뒤에도 맞게.
     */
    settle(): Promise<void> {
      if (!queue.ready || queue.error() || areaBlocked) return Promise.reject(new Error(UNCERTAIN_SCAN_MESSAGE));
      if (queue.size() === 0) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        waiters.current.push({ resolve, reject });
        // 다 보내지면 렌더를 기다리지 않고 바로 풀린다 — 렌더가 미뤄지는 동안(act 범위 등) 기다려도 매달리지 않게.
        // 결과를 모르는 스캔이면 이 약속은 풀리지 않고, 위 effect 가 거절한다
        queue.settle().then(resolve, () => reject(new Error(UNCERTAIN_SCAN_MESSAGE)));
      });
    },
    retryHead: () => queue.retryHead(),
    /** 강제출고(F10, §7.4) — 남은 미피킹 수량을 배정 기준으로 채우고 출고 */
    async forceOut(): Promise<void> {
      try {
        apply(
          await force.mutateAsync({
            shipmentId: box.shipmentId,
            reason: STATION_FORCE_REASON,
            idempotencyKey: crypto.randomUUID(),
          })
        );
      } catch (error) {
        eventsRef.current.onRejected(errorMessage(error, 'outbound'), null);
      }
    },
  };
}
