import { useEffect, type RefObject } from 'react';
import { inspectionRows, inspectionTotals } from '../../domains/outbound/inspection';
import type { ShipmentByWaybill } from '../../domains/outbound/types';
import { useStationActions } from '../ActionRegistry';
import { INSPECTION_ACTIONS } from './inspectionActions';
import type { Alert } from './model';
import { BigPanel, BoxCard, LineTable, QueueTrouble, RecentList, WorkGrid } from './panels';
import type { RecentEntry } from './recent';
import { INTAKE_BLOCKED_MESSAGE, useInspectionBox } from './useInspectionBox';

/** 부모(출고 검수 화면)가 송장인지 상품인지 가른 뒤 상품을 넘기는 곳. 내려놓기·전환 전에 앞 스캔을 다 보낸다 */
export interface BoxWorkHandle {
  accept(code: string): void;
  settle(): Promise<void>;
}

/** 검수 중(스펙 §6.3·§6.4, 목업 ②) — 박스마다 새로 마운트된다(key) */
export function InspectWork({
  box,
  handleRef,
  alert,
  recent,
  onAlert,
  onScanned,
  onShipped,
  onExcess,
  onPutDown,
}: {
  box: ShipmentByWaybill;
  handleRef: RefObject<BoxWorkHandle | null>;
  alert: Alert | null;
  recent: readonly RecentEntry[];
  onAlert(message: string, detail?: string): void;
  onScanned(name: string, quantity: number): void;
  onShipped(box: ShipmentByWaybill): void;
  onExcess(): void;
  onPutDown(): void;
}) {
  const nameOf = (lineId: string | null) => box.lines.find((line) => line.shipmentLineId === lineId)?.skuName ?? '';
  const work = useInspectionBox(box, {
    onAccepted: (lineId, quantity) => onScanned(nameOf(lineId), quantity),
    onShipped: () => onShipped(box),
    onRejected: (message, barcode) => onAlert(message, barcode ?? undefined),
    onExcess,
  });

  // 부모가 상품 스캔·내려놓기에 쓰는 손잡이. 렌더가 아니라 커밋 뒤에 건다 — 박스가 바뀌는 같은 커밋에서
  // 옛 박스의 정리가 새 박스의 손잡이를 지우지 않게(React 는 정리를 등록보다 먼저 돌린다)
  useEffect(() => {
    const own: BoxWorkHandle = {
      accept(code) {
        if (!work.accept(code, 1)) onAlert(INTAKE_BLOCKED_MESSAGE, code);
      },
      settle: work.settle,
    };
    handleRef.current = own;
    return () => {
      if (handleRef.current === own) handleRef.current = null;
    };
  });

  useStationActions([{ ...INSPECTION_ACTIONS.putDown, enabled: true, run: onPutDown }]);

  const rows = inspectionRows(box.lines, work.progress);
  const totals = inspectionTotals(rows);
  return (
    <WorkGrid
      intake={work.intakeBlocked ? 'blocked' : 'open'}
      left={
        <>
          <BoxCard trackingNo={box.trackingNo} recipient={box.recipientMasked} deliveryNote={box.deliveryNote} />
          <BigPanel content={alert ? { kind: 'alert', ...alert } : { kind: 'progress', ...totals }} />
          {work.queueError ? (
            <QueueTrouble storage={!!work.storageError} onRetry={() => void work.retryHead().catch(() => {})} />
          ) : null}
        </>
      }
      right={
        <>
          <LineTable rows={rows} currentLineId={work.lastScan?.shipmentLineId ?? null} />
          <RecentList entries={recent} />
        </>
      }
    />
  );
}
