import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useApiClient } from '../../core/data/ApiClientProvider';
import { errorMessage } from '../../core/data/errorMessage';
import { useHumanKeys } from '../../core/hardware/scan/useScanner';
import { useWorkPermissions } from '../../core/operations/useWorkCapabilities';
import { excludeFromBatch } from '../../domains/outbound/batchRemove';
import { CANCEL_WAITING_SCAN_MESSAGE, cancelWaitingOf } from '../../domains/outbound/cancelWaiting';
import { inspectionRows, inspectionTotals, lineOfBarcode, remainingOf } from '../../domains/outbound/inspection';
import { fetchShipmentByWaybill } from '../../domains/outbound/queries';
import {
  buildShortPickRequest,
  reportShortPick,
  shortPickDraft,
  shortPickFailure,
  type ShortPickDraftLine,
  type ShortPickReason,
  type ShortPickRequest,
  type ShortPickResult,
} from '../../domains/outbound/shortPick';
import type { ShipmentByWaybill } from '../../domains/outbound/types';
import { useDigitCommands, useStationActions, useStationKeyHints, type KeyHint } from '../ActionRegistry';
import type { StationAction } from '../actions';
import { modalOpen } from '../useStationKeys';
import { INSPECTION_ACTIONS } from './inspectionActions';
import type { Alert, BoxWorkHandle } from './model';
import { BigPanel, BoxCard, LineTable, QueueTrouble, RecentList, ScanChecking, ScanWaiting, WorkGrid, type BigPanelContent } from './panels';
import type { RecentEntry } from './recent';
import { ShortPickDialog } from './ShortPickDialog';
import { STATION_WITHDRAW_REASON, useInspectionBox } from './useInspectionBox';

/**
 * 결과를 모르는 결품(응답을 잃음·5xx·처리 중) — 반영됐을 수 있다. 다음 F9 는 이것을 같은 키·같은 본문으로 다시 보낸다(서버가
 * 저장한 응답을 돌려준다). 새로 조회해 새 키로 보내면 채움(refilled)은 줄·버전을 바꾸지 않아 두 번째 결품으로 받아들여진다.
 * 박스가 다시 마운트돼도(같은 송장 다시 찍기) 남도록 부모가 박스별로 들고 있다. 확정 성공·확정 거절에서만 지운다
 */
export interface PendingShortPick {
  idempotencyKey: string;
  request: ShortPickRequest;
  /** 창에 그대로 다시 보일 것 — 바꿀 수 없다 */
  lines: ShortPickDraftLine[];
  reason: ShortPickReason;
}

/** 수량은 세 자리까지 — 그보다 많은 줄은 F8(이 상품 전량)이 맡는다 */
const MAX_QUANTITY_DIGITS = 3;
const QUANTITY_HINTS: readonly KeyHint[] = [{ keys: '0-9', label: '수량' }];
const EDITING_HINTS: readonly KeyHint[] = [...QUANTITY_HINTS, { keys: '⌫', label: '지우기' }];
const NO_HINTS: readonly KeyHint[] = [];

/** «한 번 더 눌러 확정» 대기 중인 키(§6.3 F10·F11, 상자를 끝내는 F8) */
type Armed = 'all' | 'force' | 'withdraw' | null;

/** 검수 중(스펙 §6.3·§6.4, 목업 ②) — 박스마다 새로 마운트된다(key) */
export function InspectWork({
  box,
  seq,
  handleRef,
  alert,
  recent,
  canPrint,
  onAlert,
  onScanned,
  onShipped,
  onExcess,
  onWithdrawn,
  onPutDown,
  onReopen,
  onReprint,
  warehouseId,
  parentBusy,
  shortPickRetries,
  onShortPicked,
  onShortPickRefused,
}: {
  box: ShipmentByWaybill;
  /** 부모가 이 화면에 붙인 번호 — 손잡이에 싣는다 */
  seq: number;
  handleRef: RefObject<BoxWorkHandle | null>;
  alert: Alert | null;
  recent: readonly RecentEntry[];
  canPrint: boolean;
  onAlert(message: string, detail?: string, item?: string): void;
  onScanned(name: string, quantity: number): void;
  /** 출고됐다 — 상자를 끝낸 상품 스캔이 있으면 그 이름·수량(강제출고면 null) */
  onShipped(box: ShipmentByWaybill, final: { name: string; quantity: number } | null): void;
  onExcess(): void;
  onWithdrawn(box: ShipmentByWaybill, barcode: string): void;
  onPutDown(): void;
  /** 박스 빼기 뒤 — 송장을 다시 조회해 화면을 정한다(뺄 상품·빠진 박스) */
  onReopen(box: ShipmentByWaybill): void;
  onReprint(box: ShipmentByWaybill): void;
  warehouseId: string;
  /** 부모가 조회·전환·출력 중이다 — 그 결과가 이 박스를 바꿀 수 있으니 결품을 시작하지 않는다 */
  parentBusy: boolean;
  /** 결과를 모르는 결품, 박스(shipmentId)별 */
  shortPickRetries: Map<string, PendingShortPick>;
  /** 결품 결과 — 부모가 채움이면 자동 출력·송장 대기, 아니면 다시 조회한다(§7.2) */
  onShortPicked(box: ShipmentByWaybill, result: ShortPickResult): void;
  /** 결품이 확정 거절됐다(보내기 전 판정 포함) — 부모가 박스를 다시 조회해 새 수량으로 다시 그린 뒤 사유를 보인다 */
  onShortPickRefused(box: ShipmentByWaybill, message: string): void;
}) {
  const api = useApiClient();
  const permissions = useWorkPermissions();
  // 오른 줄을 못 찾으면(다시 연 박스의 저장된 스캔) 바코드로 알아보고, 그래도 모르면 바코드를 그대로 적는다
  const nameOf = (lineId: string | null, barcode: string) =>
    box.lines.find((line) => line.shipmentLineId === lineId)?.skuName ??
    lineOfBarcode(box.lines, barcode)?.skuName ??
    `상품 바코드 ${barcode}`;
  // 부분 취소를 기다리는 박스 — 검수하지 않고 박스 빼기로 보낸다
  const cancelWaiting = cancelWaitingOf(box);
  const work = useInspectionBox(box, {
    onAccepted: (lineId, quantity, barcode) => onScanned(nameOf(lineId, barcode), quantity),
    onShipped: (final) =>
      onShipped(box, final ? { name: nameOf(final.shipmentLineId, final.barcode), quantity: final.quantity } : null),
    onRejected: (message, barcode, scannedName) => onAlert(message, barcode ?? undefined, scannedName),
    onWithdrawn: (barcode) => onWithdrawn(box, barcode),
    onExcess,
  });

  const [quantity, setQuantity] = useState<string | null>(null);
  const quantityRef = useRef(quantity);
  quantityRef.current = quantity;
  const [armed, setArmed] = useState<Armed>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [shortOpen, setShortOpen] = useState(false);
  const [shortBusy, setShortBusy] = useState(false);

  // 손잡이는 마지막 렌더의 큐를 부른다 — 화면이 «받음» 으로 그려진 뒤 이 커밋의 effect 가 돌기 전에 온 스캔이
  // 앞 렌더(아직 막힘)의 판정으로 거절되지 않게
  const latest = useRef(work);
  latest.current = work;

  // 부모가 상품 스캔·내려놓기에 쓰는 손잡이. 렌더가 아니라 커밋 뒤에 건다 — 박스가 바뀌는 같은 커밋에서
  // 옛 박스의 정리가 새 박스의 손잡이를 지우지 않게(React 는 정리를 등록보다 먼저 돌린다)
  useEffect(() => {
    const own: BoxWorkHandle = {
      shipmentId: box.shipmentId,
      seq,
      accept(code) {
        // 스캔은 무장을 푼다. 수량은 이 스캔 한 번에 쓰고 1 로 돌아간다(§6.3)
        setArmed(null);
        if (cancelWaiting) {
          onAlert(CANCEL_WAITING_SCAN_MESSAGE, code);
          return;
        }
        const typed = quantityRef.current;
        if (typed !== null) setQuantity(null);
        const count = typed ? Math.max(1, Number(typed)) : 1;
        if (!latest.current.accept(code, count)) onAlert(latest.current.blockedMessage(), code);
      },
      disarm: () => setArmed(null),
      settle: () => latest.current.settle(),
      waitingForNetwork: () => latest.current.waitingNow(),
    };
    handleRef.current = own;
    return () => {
      if (handleRef.current === own) handleRef.current = null;
    };
  });

  // 수량 — 숫자를 치면(사람 키) 또는 숫자 명령(%91%N)을 찍으면 바로 시작한다(§5.3). 기능키를 쓰지 않는다: 탭 키와 겹친다.
  // 입력칸을 쓰지 않는다: 입력칸에 포커스가 가면 스캔 버퍼가 아무것도 받지 않는다(PR B 계약 메모).
  // 결품 창처럼 숫자를 받는 창이 열려 있으면 그 창이 숫자를 쓴다
  const typeDigit = useCallback((digit: number) => {
    if (modalOpen()) return;
    setArmed(null);
    setQuantity((q) => `${q ?? ''}${digit}`.replace(/^0+(?=\d)/, '').slice(0, MAX_QUANTITY_DIGITS));
  }, []);
  const typing = !shortOpen && !cancelWaiting && (quantity !== null || !work.intakeBlocked);
  useDigitCommands(typing ? typeDigit : null);
  useHumanKeys(
    typing
      ? (key: string) => {
          if (/^\d$/.test(key)) typeDigit(Number(key));
          else if (key === 'Backspace') setQuantity((q) => (q === null ? q : q.slice(0, -1)));
        }
      : null
  );
  useStationKeyHints(!typing ? NO_HINTS : quantity !== null ? EDITING_HINTS : QUANTITY_HINTS);

  const remaining = work.lastScan ? remainingOf(work.progress, work.lastScan.shipmentLineId) : 0;
  const canForce = permissions.data?.stationForceDispatch === true;
  // F9 — 권한 미리보기의 shortPick(PR A 계약 메모), 옛 core 가 아님(버전 필드), 대기·피킹 중일 때만(빼는 중·다른 오퍼레이션 대기면 서버가 409)
  const draft = shortPickDraft(box.lines, work.progress);
  const canShortPick =
    permissions.data?.shortPick === true &&
    box.shortPickContext !== undefined &&
    (work.workItemStatus === 'queued' || work.workItemStatus === 'picking');

  const retry = shortPickRetries.get(box.shipmentId) ?? null;

  const confirmShortPick = async (lines: ReadonlyArray<{ shipmentLineId: string; qty: number }>, reason: ShortPickReason) => {
    setShortBusy(true);
    try {
      let sent = shortPickRetries.get(box.shipmentId);
      const priorUncertain = Boolean(sent);

      if (!sent) {
        // 버전은 스캔마다 낡는다 — 보내기 직전에 다시 조회한 값으로 보낸다(PR A 계약 메모). 남은 수량이 창의 수량보다
        // 줄었으면(다른 스테이션이 더 찍음) 보내지 않는다 — 부모가 박스를 다시 그려 «다시 F9» 가 새 수량으로 열린다
        let fresh: ShipmentByWaybill;
        try {
          fresh = await fetchShipmentByWaybill(api, box.trackingNo, warehouseId);
        } catch (error) {
          setShortOpen(false);
          onAlert(errorMessage(error, 'outbound'));
          return;
        }
        const built = buildShortPickRequest(fresh, lines, reason);
        if (!built.ok) {
          setShortOpen(false);
          onShortPickRefused(box, built.message);
          return;
        }
        sent = {
          idempotencyKey: crypto.randomUUID(),
          request: built.request,
          lines: draft.map((line) => ({ ...line, qty: lines.find((l) => l.shipmentLineId === line.shipmentLineId)?.qty ?? 0 })),
          reason,
        };
        shortPickRetries.set(box.shipmentId, sent);
      }
      try {
        const result = await reportShortPick(api, box.shipmentId, sent.request, sent.idempotencyKey);
        shortPickRetries.delete(box.shipmentId);
        setShortOpen(false);
        onShortPicked(box, result);
      } catch (error) {
        setShortOpen(false);
        const failure = shortPickFailure(error, priorUncertain);
        if (failure.kind === 'rejected') {
          shortPickRetries.delete(box.shipmentId);
          onShortPickRefused(box, failure.message);
        } else onAlert(failure.message);
      }
    } finally {
      setShortBusy(false);
    }
  };

  /** 첫 누름은 무장, 같은 키를 한 번 더 누르면 실행(§6.3 F10·F11, §7.4) */
  const arm = (kind: Exclude<Armed, null>, act: () => void) => {
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

  const rows = inspectionRows(box.lines, work.progress);
  const totals = inspectionTotals(rows);
  // 직전에 찍은 줄 말고는 다 찼다 — 이 F8 이 상자를 출고까지 끝낸다(찍지 않은 상품이 담긴 채 나가지 않게 한 번 더 받는다)
  const allFinishesBox =
    remaining > 0 && rows.every((row) => row.done || row.shipmentLineId === work.lastScan?.shipmentLineId);
  // 직전에 찍은 줄의 «주문 − 스캔» 을 그 바코드로 한 번 더 — 서버에는 일반 스캔이다(§6.3)
  const sendAll = () => {
    if (work.lastScan && !work.accept(work.lastScan.barcode, remaining)) onAlert(work.blockedMessage());
  };

  const actions: StationAction[] = [
    {
      ...INSPECTION_ACTIONS.all,
      label: armed === 'all' ? '전량 담고 출고 확정' : INSPECTION_ACTIONS.all.label,
      enabled: work.idle && remaining > 0 && !cancelWaiting,
      run: () => {
        if (allFinishesBox) {
          arm('all', sendAll);
          return;
        }
        setArmed(null);
        setQuantity(null);
        sendAll();
      },
    },
    ...(canShortPick
      ? [
          {
            ...INSPECTION_ACTIONS.shortPick,
            enabled:
              work.idle && (draft.length > 0 || retry !== null) && !shortBusy && !withdrawing && !parentBusy && !cancelWaiting,
            run: () => {
              setArmed(null);
              setQuantity(null);
              setShortOpen(true);
            },
          },
        ]
      : []),
    ...(canForce
      ? [
          {
            ...INSPECTION_ACTIONS.force,
            label: armed === 'force' ? '강제출고 확정' : INSPECTION_ACTIONS.force.label,
            enabled: work.idle && !work.forcing && !cancelWaiting,
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

  const big: BigPanelContent = armed
    ? armedPanel(armed, remaining)
    : quantity !== null
      ? { kind: 'quantity', value: quantity }
      : alert
        ? { kind: 'alert', ...alert }
        : cancelWaiting
          ? { kind: 'cancelWaiting', ...cancelWaiting }
          : { kind: 'progress', ...totals };
  return (
    <>
      <WorkGrid
        intake={work.intakeBlocked || cancelWaiting ? 'blocked' : 'open'}
        left={
          <>
            <BoxCard
              trackingNo={box.trackingNo}
              recipient={box.recipientMasked}
              deliveryNote={box.deliveryNote}
              ownerName={box.ownerName}
              split={box.split}
            />
            <BigPanel content={big} />
            {work.checking.length > 0 ? (
              <ScanChecking
                scans={work.checking.map((scan) => ({
                  name: scan.name ?? (scan.barcode ? `상품 바코드 ${scan.barcode}` : '강제출고'),
                  quantity: scan.quantity,
                }))}
              />
            ) : work.queueError ? (
              <QueueTrouble storage={!!work.storageError} onRetry={() => void work.retryHead().catch(() => {})} />
            ) : work.waitingForNetwork > 0 ? (
              <ScanWaiting count={work.waitingForNetwork} />
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
      {shortOpen ? (
        <ShortPickDialog
          lines={retry?.lines ?? draft}
          initialReason={retry?.reason}
          locked={retry !== null}
          busy={shortBusy}
          onCancel={() => setShortOpen(false)}
          onConfirm={(lines, reason) => void confirmShortPick(lines, reason)}
        />
      ) : null}
    </>
  );
}

function armedPanel(armed: Exclude<Armed, null>, remaining: number): BigPanelContent {
  switch (armed) {
    case 'all':
      return { kind: 'armed', keyLabel: 'F8', label: `남은 ${remaining}개를 담고 출고 완료` };
    case 'force':
      return { kind: 'armed', keyLabel: 'F10', label: '강제출고' };
    case 'withdraw':
      return { kind: 'armed', keyLabel: 'F11', label: '박스 빼기' };
  }
}
