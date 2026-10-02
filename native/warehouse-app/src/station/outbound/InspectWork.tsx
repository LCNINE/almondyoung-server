import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useApiClient } from '../../core/data/ApiClientProvider';
import { errorMessage } from '../../core/data/errorMessage';
import { useHumanKeys } from '../../core/hardware/scan/useScanner';
import { useWorkPermissions } from '../../core/operations/useWorkCapabilities';
import { excludeFromBatch } from '../../domains/outbound/batchRemove';
import { inspectionRows, inspectionTotals, remainingOf } from '../../domains/outbound/inspection';
import type { ShipmentByWaybill } from '../../domains/outbound/types';
import { useDigitCommands, useStationActions } from '../ActionRegistry';
import type { StationAction } from '../actions';
import { INSPECTION_ACTIONS } from './inspectionActions';
import type { Alert } from './model';
import { BigPanel, BoxCard, LineTable, QueueTrouble, RecentList, WorkGrid, type BigPanelContent } from './panels';
import type { RecentEntry } from './recent';
import { INTAKE_BLOCKED_MESSAGE, STATION_WITHDRAW_REASON, useInspectionBox } from './useInspectionBox';

/** 부모(출고 검수 화면)가 송장인지 상품인지 가른 뒤 상품을 넘기는 곳. 내려놓기·전환 전에 앞 스캔을 다 보낸다 */
export interface BoxWorkHandle {
  accept(code: string): void;
  /** 스캔이 이 화면에 닿았다 — 부모가 거절한 송장 스캔도 «한 번 더» 대기를 푼다 */
  disarm(): void;
  settle(): Promise<void>;
}

/** 수량은 세 자리까지 — 그보다 많은 줄은 F8(이 상품 전량)이 맡는다 */
const MAX_QUANTITY_DIGITS = 3;

/** «한 번 더 눌러 확정» 대기 중인 키(§6.3 F10·F11) */
type Armed = 'force' | 'withdraw' | null;

/** 검수 중(스펙 §6.3·§6.4, 목업 ②) — 박스마다 새로 마운트된다(key) */
export function InspectWork({
  box,
  handleRef,
  alert,
  recent,
  canPrint,
  onAlert,
  onScanned,
  onShipped,
  onExcess,
  onPutDown,
  onReopen,
  onReprint,
}: {
  box: ShipmentByWaybill;
  handleRef: RefObject<BoxWorkHandle | null>;
  alert: Alert | null;
  recent: readonly RecentEntry[];
  canPrint: boolean;
  onAlert(message: string, detail?: string): void;
  onScanned(name: string, quantity: number): void;
  onShipped(box: ShipmentByWaybill): void;
  onExcess(): void;
  onPutDown(): void;
  /** 박스 빼기 뒤 — 송장을 다시 조회해 화면을 정한다(뺄 상품·빠진 박스) */
  onReopen(box: ShipmentByWaybill): void;
  onReprint(box: ShipmentByWaybill): void;
}) {
  const api = useApiClient();
  const permissions = useWorkPermissions();
  const nameOf = (lineId: string | null) => box.lines.find((line) => line.shipmentLineId === lineId)?.skuName ?? '';
  const work = useInspectionBox(box, {
    onAccepted: (lineId, quantity) => onScanned(nameOf(lineId), quantity),
    onShipped: () => onShipped(box),
    onRejected: (message, barcode) => onAlert(message, barcode ?? undefined),
    onExcess,
  });

  const [quantity, setQuantity] = useState<string | null>(null);
  const quantityRef = useRef(quantity);
  quantityRef.current = quantity;
  const [armed, setArmed] = useState<Armed>(null);
  const [withdrawing, setWithdrawing] = useState(false);

  // 손잡이는 마지막 렌더의 큐를 부른다 — 화면이 «받음» 으로 그려진 뒤 이 커밋의 effect 가 돌기 전에 온 스캔이
  // 앞 렌더(아직 막힘)의 판정으로 거절되지 않게
  const latest = useRef(work);
  latest.current = work;

  // 부모가 상품 스캔·내려놓기에 쓰는 손잡이. 렌더가 아니라 커밋 뒤에 건다 — 박스가 바뀌는 같은 커밋에서
  // 옛 박스의 정리가 새 박스의 손잡이를 지우지 않게(React 는 정리를 등록보다 먼저 돌린다)
  useEffect(() => {
    const own: BoxWorkHandle = {
      accept(code) {
        // 스캔은 무장을 푼다. 수량은 이 스캔 한 번에 쓰고 1 로 돌아간다(§6.3)
        setArmed(null);
        const typed = quantityRef.current;
        if (typed !== null) setQuantity(null);
        const count = typed ? Math.max(1, Number(typed)) : 1;
        if (!latest.current.accept(code, count)) onAlert(INTAKE_BLOCKED_MESSAGE, code);
      },
      disarm: () => setArmed(null),
      settle: () => latest.current.settle(),
    };
    handleRef.current = own;
    return () => {
      if (handleRef.current === own) handleRef.current = null;
    };
  });

  // F7 수량 — 키보드 숫자(사람 키)와 숫자 명령(%91%N)이 같은 칸에 들어간다(§5.3). 입력칸을 쓰지 않는다:
  // 입력칸에 포커스가 가면 스캔 버퍼가 아무것도 받지 않는다(PR B 계약 메모)
  const typeDigit = useCallback(
    (digit: number) =>
      setQuantity((q) => (q === null ? q : `${q}${digit}`.replace(/^0+(?=\d)/, '').slice(0, MAX_QUANTITY_DIGITS))),
    []
  );
  useDigitCommands(quantity !== null ? typeDigit : null);
  useHumanKeys(
    quantity !== null
      ? (key: string) => {
          if (/^\d$/.test(key)) typeDigit(Number(key));
          else if (key === 'Backspace') setQuantity((q) => (q === null ? q : q.slice(0, -1)));
        }
      : null
  );

  const remaining = work.lastScan ? remainingOf(work.progress, work.lastScan.shipmentLineId) : 0;
  const canForce = permissions.data?.stationForceDispatch === true;

  /** 첫 누름은 무장, 같은 키를 한 번 더 누르면 실행(§6.3 F10·F11, §7.4) */
  const arm = (kind: 'force' | 'withdraw', act: () => void) => {
    setQuantity(null);
    if (armed === kind) {
      setArmed(null);
      act();
    } else setArmed(kind);
  };

  const withdrawBox = async () => {
    if (!box.batchId) return;
    setWithdrawing(true);
    try {
      await excludeFromBatch(api, {
        batchId: box.batchId,
        shipmentId: box.shipmentId,
        reason: STATION_WITHDRAW_REASON,
        idempotencyKey: crypto.randomUUID(),
      });
      onReopen(box);
    } catch (error) {
      onAlert(errorMessage(error, 'outbound'));
      setWithdrawing(false);
    }
  };

  const actions: StationAction[] = [
    {
      ...INSPECTION_ACTIONS.quantity,
      enabled: !work.intakeBlocked,
      run: () => {
        setArmed(null);
        setQuantity('');
      },
    },
    {
      ...INSPECTION_ACTIONS.all,
      enabled: work.idle && remaining > 0,
      run: () => {
        setArmed(null);
        setQuantity(null);
        // 직전에 찍은 줄의 «주문 − 스캔» 을 그 바코드로 한 번 더 — 서버에는 일반 스캔이다(§6.3)
        if (work.lastScan && !work.accept(work.lastScan.barcode, remaining)) onAlert(INTAKE_BLOCKED_MESSAGE);
      },
    },
    ...(canForce
      ? [
          {
            ...INSPECTION_ACTIONS.force,
            label: armed === 'force' ? '강제출고 확정' : INSPECTION_ACTIONS.force.label,
            enabled: work.idle && !work.forcing,
            run: () => arm('force', () => void work.forceOut()),
          },
        ]
      : []),
    {
      ...INSPECTION_ACTIONS.withdraw,
      label: armed === 'withdraw' ? '박스 빼기 확정' : INSPECTION_ACTIONS.withdraw.label,
      enabled: work.idle && box.batchId !== null && !withdrawing,
      run: () => arm('withdraw', () => void withdrawBox()),
    },
    {
      ...INSPECTION_ACTIONS.reprint,
      enabled: canPrint,
      run: () => {
        setArmed(null);
        onReprint(box);
      },
    },
    {
      ...INSPECTION_ACTIONS.putDown,
      label: quantity !== null ? '수량 취소' : armed ? '취소' : INSPECTION_ACTIONS.putDown.label,
      enabled: true,
      run: () => {
        if (quantity !== null) setQuantity(null);
        else if (armed) setArmed(null);
        else onPutDown();
      },
    },
  ];
  useStationActions(actions);

  const rows = inspectionRows(box.lines, work.progress);
  const totals = inspectionTotals(rows);
  const big: BigPanelContent = armed
    ? { kind: 'armed', keyLabel: armed === 'force' ? 'F10' : 'F11', label: armed === 'force' ? '강제출고' : '박스 빼기' }
    : quantity !== null
      ? { kind: 'quantity', value: quantity }
      : alert
        ? { kind: 'alert', ...alert }
        : { kind: 'progress', ...totals };
  return (
    <WorkGrid
      intake={work.intakeBlocked ? 'blocked' : 'open'}
      left={
        <>
          <BoxCard trackingNo={box.trackingNo} recipient={box.recipientMasked} deliveryNote={box.deliveryNote} />
          <BigPanel content={big} />
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
