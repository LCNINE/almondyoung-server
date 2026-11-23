import { useEffect, useRef, useState } from 'react';
import { onlineManager } from '@tanstack/react-query';
import { errorMessage } from '../../core/data/errorMessage';
import { ApiError } from '../../core/data/httpClient';
import { useWorkScanQueue } from '../../core/hardware/scan/useWorkScanQueue';
import { useWorkAreaBlocked } from '../../core/operations/WorkBoundary';
import { rememberBoxLabel } from '../../core/operations/boxChecks';
import { useWorkRuntime } from '../../core/operations/OperationContext';
import { useBoxChecks } from '../../core/operations/workArea';
import { formatTrackingNo, lineOfBarcode, progressOf, scanNamesOf, scannedLineOf } from '../../domains/outbound/inspection';
import { useForceSimpleOutbound, useSimpleOutboundScan } from '../../domains/outbound/mutations';
import type { ShipmentByWaybill, SimpleOutboundLineProgress, SimpleOutboundState } from '../../domains/outbound/types';

/** 스테이션 강제출고의 고정 사유(스펙 §7.4) — 서버는 강제하지 않는다. 사후 점검이 이 문자열로 거른다 */
export const STATION_FORCE_REASON = 'station_force_command';
/** 스테이션 박스 빼기(F11)의 고정 사유 — 강제출고와 같은 꼴(계획이 정함) */
export const STATION_WITHDRAW_REASON = 'station_withdraw_command';
export const INTAKE_BLOCKED_MESSAGE = '앞 스캔을 확인하고 있어요. 확인이 끝난 뒤 다시 찍어 주세요.';
export const UNCERTAIN_SCAN_MESSAGE = '앞 스캔이 처리됐는지 확인하지 못했어요. 같은 상품을 다시 찍지 마세요.';
// 보낸 뒤 응답을 기다리다 끊긴 스캔도 있다 — «보내지 못했다» 고 단정하지 않는다
export const WAITING_SCAN_MESSAGE = '앞 스캔이 아직 끝나지 않았어요. 연결된 뒤 다시 해 주세요.';

/** 오프라인이라 앞 스캔이 멈춰 있다 — 연결되면 그대로 보내지므로 «결과 모름» 과 다르다 */
export class ScanWaitingError extends Error {
  constructor() {
    super(WAITING_SCAN_MESSAGE);
  }
}

/** 내려놓기·전환 전 정리 결과 — `checking` 이면 결과 모름이 남아 확인할 일로 넘어갔다 */
export type SettleOutcome = 'settled' | 'checking';

/** 서버가 반영한 상품 스캔 하나 */
export interface AcceptedScan {
  shipmentLineId: string | null;
  quantity: number;
  barcode: string;
}

export interface InspectionBoxEvents {
  /**
   * 서버가 반영한 스캔 — 오른 줄과 수량, 찍은 바코드. 다시 연 박스의 저장된 스캔은 조회한 진행에 이미 들어 있어 오른 줄을 못 찾는다(null) —
   * 그때는 바코드로 상품을 알아본다
   */
  onAccepted(shipmentLineId: string | null, quantity: number, barcode: string): void;
  /** 마지막 스캔(또는 강제출고 — 그때는 null)으로 출고됐다. 상자를 끝낸 스캔도 기록에 남게 함께 넘긴다 */
  onShipped(final: AcceptedScan | null): void;
  /** 서버가 거절했거나 결과를 모른다 — 화면이 오류로 알린다. 이 상자에 없는 상품이면 서버가 알려 준 그 상품 이름도 */
  onRejected(message: string, barcode: string | null, scannedName?: string): void;
  /** 그 사이 박스가 배치에서 빠져 서버가 상품을 받지 않았다 — 화면이 뺄 상품으로 넘어간다 */
  onWithdrawn(barcode: string): void;
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
  const apply = (state: SimpleOutboundState, final: AcceptedScan | null = null): boolean => {
    progressRef.current = state.lines;
    setProgress(state.lines);
    setWorkItemStatus(state.workItemStatus);
    if (state.status !== 'shipped') return false;
    shipped.current = true;
    eventsRef.current.onShipped(final);
    return true;
  };

  const queue = useWorkScanQueue<{ barcode: string; quantity: number }>(async (input, id) => {
    if (shipped.current) {
      eventsRef.current.onExcess();
      return;
    }
    try {
      const state = await scan.mutateAsync({ shipmentId: box.shipmentId, ...input, idempotencyKey: id });
      // 내려놓은 박스의 늦은 결과 — 다른 박스의 화면을 바꾸지 않는다
      if (queue.detached()) return;
      const line = scannedLineOf(progressRef.current, state.lines);
      if (line) setLastScan({ barcode: input.barcode, shipmentLineId: line });
      const accepted = { shipmentLineId: line, quantity: input.quantity, barcode: input.barcode };
      if (!apply(state, accepted)) eventsRef.current.onAccepted(line, input.quantity, input.barcode);
    } catch (error) {
      const rejected = error instanceof ApiError && error.outcome === 'rejected';
      if (queue.detached()) {
        if (rejected) return;
        throw error;
      }

      if (rejected && error.code === 'SHIPMENT_WITHDRAWN') eventsRef.current.onWithdrawn(input.barcode);
      else
        eventsRef.current.onRejected(
          rejected ? errorMessage(error, 'outbound') : UNCERTAIN_SCAN_MESSAGE,
          input.barcode,
          rejected ? error.scannedSkuName : undefined
        );
      // 확정된 거절만 큐에서 뺀다 — 결과를 모르는 스캔은 머리에 남겨 같은 키로 다시 맞춘다
      if (!rejected) throw error;
    }
  }, `outbound:${box.shipmentId}`, () => leavable());

  const areaBlocked = useWorkAreaBlocked('outbound', {
    path: `/shipments/${box.shipmentId}/simple-outbound-scans`,
    operationId: queue.head()?.id,
  });
  const intakeBlocked = !queue.ready || !!queue.error() || areaBlocked || force.isPending;

  // 이 박스에 남은 결과 모름 — 박스만 막고, 내려놓기·전환은 허용한다(스캔은 저장돼 있고 같은 키로 다시 맞춘다)
  const checks = useBoxChecks(box.shipmentId);
  const checking = checks.length > 0;
  const checkingRef = useRef(checking);
  checkingRef.current = checking;
  const storageFailed = !!queue.storageError();
  // 출고된 박스는 떠나도 뒤에 줄 선 스캔을 «반영 안 됨» 으로 알려야 한다 — 맡기지 않는다
  const leavable = (): boolean => checkingRef.current && !shipped.current && !queue.storageError() && !queue.unsaved();
  const runtime = useWorkRuntime();
  const checkScope = checks[0]?.scope;
  const checkingScans = checks.map((op) => scanOf(op.bodyJson));
  // 결과 모름이 된 상품의 이름도 함께 남긴다 — «확인할 일» 목록은 박스를 열지 않아 줄을 모른다
  const checkingBarcodes = [...new Set(checkingScans.map((scan) => scan.barcode).filter(Boolean))].join('\n');
  useEffect(() => {
    if (!runtime || !checkScope) return;
    void rememberBoxLabel(runtime.store, checkScope, box.shipmentId, {
      trackingNo: formatTrackingNo(box.trackingNo),
      items: scanNamesOf(box.lines, checkingBarcodes ? checkingBarcodes.split('\n') : []),
    }).catch(() => {});
  }, [runtime, checkScope, box.shipmentId, box.trackingNo, box.lines, checkingBarcodes]);

  // settle 을 기다리는 쪽(내려놓기·전환). 결과를 모르는 단순출고 스캔은 실행기의 약속이 풀리지 않은 채 머물러
  // 큐의 drain 이 끝나지 않는다 — 그래서 «비었다» 와 «확인 못 한 것이 생겼다» 를 렌더마다 직접 본다.
  const waiters = useRef<Array<{ resolve: (outcome: SettleOutcome) => void; reject: (error: Error) => void }>>([]);
  const unsettled = !queue.ready || !!queue.error() || areaBlocked;
  const waitingForNetwork = scan.isPaused ? queue.size() : 0;
  // 렌더를 기다리지 않는 판정 — 끊긴 직후 찍은 스캔은 아직 멈춤으로 그려지기 전일 수 있다
  const waitingNow = () => queue.size() > 0 && (scan.isPaused || !onlineManager.isOnline());
  useEffect(() => {
    if (waiters.current.length === 0) return;
    if (checking && !storageFailed) {
      // 뒤에 찍은 스캔이 아직 저장 중이면 저장될 때까지 기다린다 — 저장 전에 떠나면 그 스캔을 잃는다
      if (!queue.unsaved()) waiters.current.splice(0).forEach((w) => w.resolve('checking'));
    } else if (unsettled) waiters.current.splice(0).forEach((w) => w.reject(new Error(UNCERTAIN_SCAN_MESSAGE)));
    else if (waitingForNetwork > 0) waiters.current.splice(0).forEach((w) => w.reject(new ScanWaitingError()));
    else if (queue.size() === 0) waiters.current.splice(0).forEach((w) => w.resolve('settled'));
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
    /** 오프라인이라 보내지 못하고 기다리는 상품 스캔 수 — 연결되면 큐가 그대로 보낸다 */
    waitingForNetwork,
    waitingNow,
    storageError: queue.storageError(),
    /** 이 박스에서 처리 여부를 확인하고 있는 스캔(바코드·상품 이름·수량) — 다시 열었을 때 같은 상품을 또 찍지 않게 */
    checking: checkingScans.map((scan) => ({
      ...scan,
      name: scan.barcode ? (lineOfBarcode(box.lines, scan.barcode)?.skuName ?? null) : null,
    })),
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
    settle(): Promise<SettleOutcome> {
      if (leavable()) return Promise.resolve('checking');
      if (!queue.ready || queue.error() || areaBlocked) return Promise.reject(new Error(UNCERTAIN_SCAN_MESSAGE));
      if (waitingNow()) return Promise.reject(new ScanWaitingError());
      if (queue.size() === 0) return Promise.resolve('settled');
      return new Promise<SettleOutcome>((resolve, reject) => {
        waiters.current.push({ resolve, reject });
        // 다 보내지면 렌더를 기다리지 않고 바로 풀린다 — 렌더가 미뤄지는 동안(act 범위 등) 기다려도 매달리지 않게.
        // 결과를 모르는 스캔이면 이 약속은 풀리지 않고, 위 effect 가 확인할 일로 넘긴다
        queue.settle().then(
          () => resolve('settled'),
          () => reject(new Error(UNCERTAIN_SCAN_MESSAGE))
        );
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

function scanOf(bodyJson: string): { barcode: string; quantity: number } {
  try {
    const body = JSON.parse(bodyJson) as { barcode?: unknown; quantity?: unknown };
    return {
      barcode: typeof body.barcode === 'string' ? body.barcode : '',
      quantity: typeof body.quantity === 'number' ? body.quantity : 1,
    };
  } catch {
    return { barcode: '', quantity: 1 };
  }
}
