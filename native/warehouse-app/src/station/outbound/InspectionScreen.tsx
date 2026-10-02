import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWarehouse } from '../../app/warehouse-context';
import { useApiClient } from '../../core/data/ApiClientProvider';
import { localStoragePrefs, type DevicePrefs } from '../../core/data/devicePrefs';
import { errorMessage } from '../../core/data/errorMessage';
import { printRaw, readLabelPrinter, type PrintRaw } from '../../core/hardware/print/labelPrinter';
import { useHumanKeys, useScanEmit, useScanner } from '../../core/hardware/scan/useScanner';
import { batchProgressOf, useBatchWorkItems } from '../../domains/outbound/batchStatus';
import { classifyInspectScan, inspectionGateOf, isNotFound } from '../../domains/outbound/inspection';
import { clearLastBox, readLastBox, writeLastBox } from '../../domains/outbound/lastBox';
import { fetchShipmentByWaybill, useOutboundBatches } from '../../domains/outbound/queries';
import type { ShipmentByWaybill } from '../../domains/outbound/types';
import type { LabelItemChange } from '../../domains/outbound/waybillLabel';
import { WarehousePicker } from '../../domains/warehouse/WarehousePicker';
import { useStationActions } from '../ActionRegistry';
import type { StationAction } from '../actions';
import { useFeedback } from '../feedback/FeedbackProvider';
import { useBatchProgress } from '../status/batchProgress';
import { modalOpen } from '../useStationKeys';
import { INSPECTION_ACTIONS } from './inspectionActions';
import { InspectWork, type BoxWorkHandle } from './InspectWork';
import type { Alert, LastBox, PrintStatus } from './model';
import {
  BigPanel,
  BoxCard,
  ChangeTable,
  DoneBanner,
  ManualWaybillInput,
  RecentList,
  WaitingPrompt,
  WorkGrid,
} from './panels';
import { printWaybill } from './printWaybill';
import { pushRecent, type RecentEntry } from './recent';
import { WithdrawWork } from './WithdrawWork';
import { INTAKE_BLOCKED_MESSAGE, UNCERTAIN_SCAN_MESSAGE } from './useInspectionBox';

type View =
  | { kind: 'waiting' }
  | { kind: 'inspect'; box: ShipmentByWaybill; seq: number }
  | { kind: 'reprint'; box: ShipmentByWaybill; changes: LabelItemChange[]; print: PrintStatus }
  | { kind: 'withdraw'; box: ShipmentByWaybill; seq: number }
  | { kind: 'withdrawn'; box: ShipmentByWaybill };

/** 화면이 스스로 거절한 것 — 문구를 그대로 보인다(서버 오류 문구 변환을 거치지 않는다) */
class Refusal extends Error {}

const LOOKING_UP_MESSAGE = '송장을 확인하고 있어요. 다시 찍어 주세요.';
const EXCESS_MESSAGE = '출고가 끝난 박스에 찍은 상품은 반영되지 않았어요. 상품을 확인해 주세요.';

/** 스테이션 F1 출고 검수(스펙 §6) — 송장 스캔 즉시 시작, 상품 스캔 = +1, 마지막 스캔 = 출고, 다음 송장 */
export function InspectionScreen({ prefs = localStoragePrefs, print = printRaw }: { prefs?: DevicePrefs; print?: PrintRaw }) {
  const { warehouseId } = useWarehouse();
  if (!warehouseId) return <WarehousePicker />;
  return <Inspection key={warehouseId} warehouseId={warehouseId} prefs={prefs} print={print} />;
}

function Inspection({ warehouseId, prefs, print }: { warehouseId: string; prefs: DevicePrefs; print: PrintRaw }) {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const { signal } = useFeedback();
  const emit = useScanEmit();
  const [view, setView] = useState<View>({ kind: 'waiting' });
  // 스캔 처리는 그려진 화면이 아니라 «정한» 화면을 본다 — go() 만 바꾼다
  const viewRef = useRef(view);
  const [alert, setAlert] = useState<Alert | null>(null);
  const [last, setLast] = useState<LastBox | null>(null);
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [manual, setManual] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(() => readLastBox(prefs)?.batchId ?? null);
  const work = useRef<BoxWorkHandle | null>(null);
  const busy = useRef(false);
  const seq = useRef(0);
  const canPrint = readLabelPrinter(prefs) !== null;

  /**
   * 화면을 바꾸는 유일한 길. 박스 손잡이는 바로 비운다 — 새 화면이 그려지기 전(별도 태스크)에 온 상품 스캔이
   * 옛 박스의 큐로 가지 않고 «앞 스캔 확인 중» 으로 거절되게. 새 박스는 커밋 뒤 자기 손잡이를 단다
   */
  const go = (next: View) => {
    viewRef.current = next;
    work.current = null;
    setView(next);
  };

  // 상태바의 배치 진행(스펙 §5.5) — 마지막으로 연 박스의 배치
  const batches = useOutboundBatches(warehouseId, 'picking');
  const batchItems = useBatchWorkItems(batchId);
  const batch = batches.data?.find((b) => b.id === batchId);
  useBatchProgress(batch && batchItems.data ? batchProgressOf(batch.batchNumber, batchItems.data) : null);

  const note = useCallback(
    (entry: Omit<RecentEntry, 'id' | 'at'>) => setRecent((list) => pushRecent(list, { ...entry, at: Date.now() })),
    []
  );
  const reject = useCallback(
    (message: string, detail?: string) => {
      setAlert({ message, detail });
      signal('error');
      note({ kind: 'error', text: detail ?? message });
    },
    [signal, note]
  );

  const lookup = (code: string) => fetchShipmentByWaybill(api, code, warehouseId);
  const printFor = async (shipmentId: string): Promise<PrintStatus> => {
    const outcome = await printWaybill({ api, print, prefs }, shipmentId);
    void queryClient.invalidateQueries({ queryKey: ['waybill-label-states'] });
    return outcome.ok ? { kind: 'printed' } : { kind: 'failed', message: outcome.message };
  };
  /** 출력 결과를 그 박스의 새 송장 화면에 싣는다 — 그 사이 다른 화면으로 갔으면 버린다 */
  const settlePrint = (shipmentId: string, status: PrintStatus) => {
    const current = viewRef.current;
    if (current.kind === 'reprint' && current.box.shipmentId === shipmentId) go({ ...current, print: status });
  };

  /** 한 번에 하나 — 조회·전환·내려놓기가 겹치면 뒤의 것을 거절한다 */
  const run = async (task: () => Promise<void>) => {
    if (busy.current) {
      reject(LOOKING_UP_MESSAGE);
      return;
    }
    busy.current = true;
    try {
      await task();
    } catch (error) {
      reject(error instanceof Refusal ? error.message : errorMessage(error, 'outbound'));
    } finally {
      busy.current = false;
    }
  };

  /** 든 박스의 앞 스캔을 다 보낸다. 확인 못 한 스캔이 있으면 거절 — 내려놓으면 그 스캔이 재생될 길이 없다 */
  const settleWork = async () => {
    try {
      await work.current?.settle();
    } catch {
      throw new Refusal(UNCERTAIN_SCAN_MESSAGE);
    }
  };

  /** 조회 결과로 화면을 정한다(스펙 §6.2). quiet 는 하던 박스 복구 — 거절이면 조용히 대기로 */
  const show = async (found: ShipmentByWaybill, quiet = false) => {
    const gate = inspectionGateOf(found, { warehouseId, canPrint });
    if (gate.kind === 'reject') {
      if (quiet) clearLastBox(prefs);
      else reject(gate.message, found.trackingNo);
      return;
    }
    setAlert(null);
    setLast(null);
    if (found.batchId) setBatchId(found.batchId);
    note({ kind: 'waybill', text: found.trackingNo });
    signal('success');
    if (gate.kind === 'withdrawn') {
      clearLastBox(prefs);
      go({ kind: 'withdrawn', box: found });
      return;
    }
    if (gate.kind === 'withdraw') {
      writeLastBox(prefs, found);
      go({ kind: 'withdraw', box: found, seq: ++seq.current });
      return;
    }
    if (gate.kind === 'reprint') {
      clearLastBox(prefs);
      go({ kind: 'reprint', box: found, changes: gate.changes, print: { kind: 'printing' } });
      const status = await printFor(found.shipmentId);
      settlePrint(found.shipmentId, status);
      if (status.kind === 'printed') note({ kind: 'printed', text: found.trackingNo });
      else signal('error');
      return;
    }
    writeLastBox(prefs, found);
    go({ kind: 'inspect', box: found, seq: ++seq.current });
  };

  const open = (code: string) => run(async () => show(await lookup(code)));

  /** 상품을 든 박스로. 손잡이가 없으면(새 화면이 아직 안 그려졌다) 받지 않는다 */
  const giveProduct = (code: string) => {
    if (!work.current) {
      reject(INTAKE_BLOCKED_MESSAGE, code);
      return;
    }
    setAlert(null);
    work.current.accept(code);
  };

  /** 박스를 든 채 찍은 송장(U13) — 앞 상품 스캔을 다 보낸 뒤 내려놓고 연다. 송장이 아니었으면(404) 상품으로 넘긴다 */
  const switchTo = (code: string, kind: 'same-waybill' | 'maybe-waybill', current: ShipmentByWaybill) =>
    run(async () => {
      let found: ShipmentByWaybill | null = null;
      if (kind === 'maybe-waybill') {
        try {
          found = await lookup(code);
        } catch (error) {
          if (!isNotFound(error)) throw error;
          giveProduct(code);
          return;
        }
      }
      await settleWork();
      // 같은 박스면 방금 보낸 스캔까지 반영된 진행으로 다시 연다 — 몇 번을 찍어도 서버는 바뀌지 않는다(§6.2)
      if (found === null || found.shipmentId === current.shipmentId) found = await lookup(code);
      await show(found);
    });

  /** Esc 내려놓기 — «아무것도 작업 중이 아닌 초기 상태»(U13). 찍은 수량은 서버에 남는다 */
  const putDown = () =>
    run(async () => {
      await settleWork();
      clearLastBox(prefs);
      setAlert(null);
      go({ kind: 'waiting' });
    });

  const onScan = (code: string) => {
    // 결품 창이 열려 있다 — 창의 키만 받는다. 스캐너의 Enter 가 창을 확정하지 않는다(사람 키 채널이 거른다)
    if (modalOpen()) {
      signal('error');
      return;
    }
    setManual(null);
    work.current?.disarm();
    const current = viewRef.current;
    if (current.kind !== 'inspect' && current.kind !== 'withdraw') {
      void open(code);
      return;
    }
    const kind = classifyInspectScan(code, current.box.trackingNo);
    if (kind !== 'product') {
      void switchTo(code, kind, current.box);
      return;
    }
    if (busy.current) {
      reject(LOOKING_UP_MESSAGE, code);
      return;
    }
    giveProduct(code);
  };
  const scanRef = useRef(onScan);
  scanRef.current = onScan;
  useScanner(useCallback((event: { code: string }) => scanRef.current(event.code), []));

  // §5.6 — 송장 대기에서 사람이 숫자를 치면 직접 입력칸이 열린다(송장 바코드가 훼손됐을 때).
  // 오류가 떠 있으면 빨간 칸이 입력칸 자리를 차지하므로 함께 지운다
  useHumanKeys(
    view.kind === 'waiting' && manual === null
      ? (key: string) => {
          if (!/^\d$/.test(key)) return;
          setAlert(null);
          setManual(key);
        }
      : null
  );

  // 하던 박스는 다시 그려질 때 다시 연다(재시작·탭 이동) — 그 박스의 저장된 스캔이 이어서 재생된다.
  // main.tsx 가 StrictMode 라 effect 가 두 번 돈다 — 한 번만 돌게 꺼내 쓰고 비운다
  const restoreOnce = useRef<(() => void) | null>(() => {
    const saved = readLastBox(prefs);
    if (!saved) return;
    void run(async () => {
      try {
        await show(await lookup(saved.trackingNo), true);
      } catch {
        clearLastBox(prefs);
      }
    });
  });
  useEffect(() => {
    const restore = restoreOnce.current;
    restoreOnce.current = null;
    restore?.();
  }, []);

  const onShipped = (box: ShipmentByWaybill) => {
    clearLastBox(prefs);
    signal('complete');
    note({ kind: 'shipped', text: box.trackingNo });
    setLast({ kind: 'shipped', trackingNo: box.trackingNo });
    setAlert(null);
    go({ kind: 'waiting' });
  };

  /** 박스 빼기(F11) 뒤 — 송장을 다시 조회해 화면을 정한다(뺄 상품·빠진 박스) */
  const reopen = (box: ShipmentByWaybill) =>
    run(async () => {
      await settleWork();
      await show(await lookup(box.trackingNo));
    });

  /** F12 — 든 박스의 송장을 다시 뽑는다 */
  const reprintBox = (box: ShipmentByWaybill) =>
    run(async () => {
      const status = await printFor(box.shipmentId);
      if (status.kind === 'failed') {
        reject(status.message);
        return;
      }
      note({ kind: 'printed', text: box.trackingNo });
      signal('success');
    });

  const reprintView = () =>
    run(async () => {
      const current = viewRef.current;
      if (current.kind !== 'reprint') return;
      go({ ...current, print: { kind: 'printing' } });
      const status = await printFor(current.box.shipmentId);
      settlePrint(current.box.shipmentId, status);
      if (status.kind === 'printed') note({ kind: 'printed', text: current.box.trackingNo });
      else signal('error');
    });

  const putDownAction: StationAction = { ...INSPECTION_ACTIONS.putDown, enabled: true, run: () => void putDown() };
  const actions: StationAction[] =
    view.kind === 'reprint'
      ? [
          {
            ...INSPECTION_ACTIONS.reprint,
            label: '다시 출력',
            enabled: canPrint && view.print.kind !== 'printing',
            run: () => void reprintView(),
          },
          putDownAction,
        ]
      : view.kind === 'withdraw' || view.kind === 'withdrawn'
        ? [putDownAction]
        : [];
  useStationActions(actions);

  switch (view.kind) {
    case 'inspect':
      return (
        <InspectWork
          key={`${view.box.shipmentId}:${view.seq}`}
          box={view.box}
          handleRef={work}
          alert={alert}
          recent={recent}
          onAlert={reject}
          onScanned={(name, quantity) => {
            setAlert(null);
            signal('success');
            note({ kind: 'scan', text: name, qty: quantity });
          }}
          onShipped={onShipped}
          onExcess={() => reject(EXCESS_MESSAGE)}
          onPutDown={() => void putDown()}
          canPrint={canPrint}
          onReopen={(box) => void reopen(box)}
          onReprint={(box) => void reprintBox(box)}
        />
      );
    case 'reprint':
      return (
        <WorkGrid
          left={
            <>
              <BoxCard trackingNo={view.box.trackingNo} recipient={view.box.recipientMasked} />
              {/* 방금 찍은 것의 거절 사유가 출력 상태보다 먼저다(§6.2 «오류음 + 사유 한 줄») */}
              {alert ? (
                <BigPanel content={{ kind: 'alert', ...alert }} />
              ) : view.print.kind === 'failed' ? (
                <BigPanel content={{ kind: 'alert', message: view.print.message }} />
              ) : (
                <BigPanel
                  content={{
                    kind: 'notice',
                    title: view.print.kind === 'printing' ? '새 송장 출력 중' : '새 송장 출력됨',
                    message: '옛 송장은 버리고 새 송장을 찍으세요',
                  }}
                />
              )}
            </>
          }
          right={
            <>
              {view.changes.length > 0 ? <ChangeTable changes={view.changes} /> : null}
              <RecentList entries={recent} grow={view.changes.length === 0} />
            </>
          }
        />
      );
    case 'withdraw':
      return (
        <WithdrawWork
          key={`${view.box.shipmentId}:${view.seq}`}
          box={view.box}
          handleRef={work}
          prefs={prefs}
          warehouseId={warehouseId}
          alert={alert}
          recent={recent}
          onAlert={reject}
          onRemoved={(barcode) => {
            setAlert(null);
            signal('success');
            note({ kind: 'scan', text: barcode, qty: 1 });
          }}
          onDone={(box) => {
            clearLastBox(prefs);
            signal('complete');
            setAlert(null);
            setView({ kind: 'withdrawn', box });
          }}
        />
      );
    case 'withdrawn':
      return (
        <WorkGrid
          left={
            <>
              <BoxCard trackingNo={view.box.trackingNo} recipient={view.box.recipientMasked} />
              <BigPanel
                content={alert ? { kind: 'alert', ...alert } : { kind: 'notice', title: '빠진 박스', message: '송장은 버려 주세요' }}
              />
            </>
          }
          right={<RecentList entries={recent} grow />}
        />
      );
    default:
      return (
        <WorkGrid
          left={
            <>
              {alert ? (
                <BigPanel content={{ kind: 'alert', ...alert }} />
              ) : (
                <WaitingPrompt>
                  {manual !== null ? (
                    <ManualWaybillInput
                      initial={manual}
                      onClose={() => setManual(null)}
                      onSubmit={(code) => {
                        setManual(null);
                        // 버스로 보낸다 — 명령 바코드면 셸이, 아니면 위 onScan 이 송장으로 연다
                        emit({ code, source: 'hid', at: Date.now() });
                      }}
                    />
                  ) : null}
                </WaitingPrompt>
              )}
            </>
          }
          right={
            <>
              {last ? <DoneBanner last={last} /> : null}
              <RecentList entries={recent} grow />
            </>
          }
        />
      );
  }
}
