import { WorkArea } from '../../core/operations/WorkBoundary';
import { useCapabilityReader } from '../../core/operations/useWorkCapabilities';
import { useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useWarehouse } from '../../app/warehouse-context';
import {
  localStoragePrefs,
  type DevicePrefs,
} from '../../core/data/devicePrefs';
import { errorMessage } from '../../core/data/errorMessage';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { Button } from '../../core/design/Button';
import { useScanner } from '../../core/hardware/scan/useScanner';
import type { PrintRaw } from '../../core/hardware/print/labelPrinter';
import { WarehousePicker } from '../warehouse/WarehousePicker';
import { BatchLabelPrintButton } from './BatchLabelPrintButton';
import { StartBatchButton } from './StartBatchButton';
import { JoinBoxPanel } from './JoinBoxPanel';
import { RemoveBoxPanel } from './RemoveBoxPanel';
import { ReprintLabelButton } from './ReprintLabelButton';
import { labelGateOf } from './labelGate';
import type { LabelItemChange } from './waybillLabel';
import { readLastBox, writeLastBox } from './lastBox';
import { useOutboundBatches, useShipmentByWaybill } from './queries';

function OutboundQueueContent({
  prefs = localStoragePrefs,
  labelPrinting = false,
  print,
}: {
  prefs?: DevicePrefs;
  labelPrinting?: boolean;
  print?: PrintRaw;
}) {
  const { warehouseId, isSet } = useWarehouse();
  const navigate = useNavigate();
  const [notice, setNotice] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const [printGate, setPrintGate] = useState<{
    shipmentId: string;
    message: string;
    changes: LabelItemChange[];
  } | null>(null);
  const [resume] = useState(() => readLastBox(prefs));
  const lookup = useShipmentByWaybill(warehouseId);
  const capabilities = useCapabilityReader();
  const opening = useRef(false);
  const [openingState, setOpeningState] = useState(false);
  // 라벨 인쇄 중엔 useUnsavedWork 가 라우터를 막는다. 그때 navigate 하면 promise 가 끝나지 않아
  // opening 이 영영 true 로 남고 이후 스캔이 전부 무시된다 — 그래서 스캔을 입구에서 돌려보낸다.
  // 프린터도 한 대라 다른 배치의 인쇄도 같이 막는다(라벨이 섞여 나온다).
  const labelRunning = useRef(false);
  const [printingBatch, setPrintingBatch] = useState<string | null>(null);
  const onLabelRunChange = (batchId: string, running: boolean) => {
    labelRunning.current = running;
    setPrintingBatch(running ? batchId : null);
  };
  const [panel, setPanel] = useState<{ kind: 'join' | 'remove'; batchId: string } | null>(null);
  // 패널이 열려 있으면 스캔은 패널이 받는다 — 같은 스캔이 박스 열기로도 가면 안 된다.
  const panelOpen = useRef(false);
  panelOpen.current = panel !== null;
  const picking = useOutboundBatches(warehouseId, 'picking');
  const created = useOutboundBatches(warehouseId, 'created');
  // 진행 중(picking) 배치를 먼저, 아직 시작 안 한(created) 배치를 그 다음에 —
  // 각 목록 안에서는 서버가 돌려준 순서를 그대로 유지한다. 두 조회가 서로 다른
  // 시점에 도착하면 같은 배치가 created → picking 으로 전이하는 사이 양쪽에
  // 모두 실릴 수 있으므로 id 로 중복 제거한다(먼저 나온 picking 쪽을 유지).
  const seen = new Set<string>();
  const batches = [...(picking.data ?? []), ...(created.data ?? [])].filter(
    (batch) => {
      if (seen.has(batch.id)) return false;
      seen.add(batch.id);
      return true;
    }
  );

  const open = async (trackingNo: string) => {
    const code = trackingNo.trim();
    if (!code || !warehouseId || opening.current) return;
    if (labelRunning.current) {
      setNotice('송장 인쇄가 끝난 뒤 스캔해 주세요.');
      return;
    }
    opening.current = true;
    setOpeningState(true);
    setNotice(null);
    setPrintGate(null);
    try {
      const found = await lookup.mutateAsync(code);
      if (found.warehouseId && found.warehouseId !== warehouseId) {
        setNotice('송장의 창고와 선택 창고가 달라요. 창고를 확인해 주세요.');
        return;
      }
      if (found.shipmentStatus === 'shipped') {
        setNotice('이미 출고된 송장이에요');
        return;
      }
      const gate = labelGateOf(found, labelPrinting);
      if (gate.kind === 'blocked') {
        setNotice(gate.message);
        return;
      }
      if (found.workItemId === null) {
        setNotice('이 송장은 오늘 배치에 없어요 — 관리자에게 문의해 주세요');
        return;
      }
      if (gate.kind === 'withdraw') {
        setManual('');
        await navigate({
          to: '/outbound/withdraw/$shipmentId',
          params: { shipmentId: found.shipmentId },
          state: { shipment: found },
        });
        return;
      }
      if (gate.kind === 'print') {
        setPrintGate({
          shipmentId: found.shipmentId,
          message: gate.message,
          changes: gate.changes,
        });
        return;
      }
      const legacy =
        resume?.shipmentId === found.shipmentId &&
        resume.outboundContract !== 'location';
      if (
        !legacy &&
        (!found.warehouseId || !(await capabilities()).locationOutbound)
      ) {
        setNotice(
          '위치를 확인하는 출고를 사용하려면 서버 연결과 업데이트를 확인해 주세요.'
        );
        return;
      }
      const work = {
        ...found,
        outboundContract: legacy ? ('legacy' as const) : ('location' as const),
      };
      setManual('');
      writeLastBox(prefs, work);
      await navigate({
        to: '/outbound/simple/$shipmentId',
        params: { shipmentId: found.shipmentId },
        state: { shipment: work },
      });
    } catch (error) {
      setNotice(errorMessage(error, 'outbound'));
    } finally {
      opening.current = false;
      setOpeningState(false);
    }
  };

  useScanner((event) => {
    if (panelOpen.current) return;
    void open(event.code);
  });

  // 기기에 남은 건 마지막으로 열었던 스냅샷일 뿐이다 — 그 사이 다른 작업자가 더
  // 스캔했을 수 있으니 재개 시 항상 다시 조회한다. 실패하면 일반 스캔과 같은 안내를 쓴다.
  const resumeWork = () => {
    if (resume) void open(resume.trackingNo);
  };

  if (!isSet) {
    return (
      <div className="space-y-4">
        <ScreenHeader title="출고작업" backTo="/" />
        <WarehousePicker />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ScreenHeader title="출고작업" backTo="/" />
      <p className="text-sm text-neutral-500">
        송장을 스캔하면 그 박스 작업이 열립니다.
      </p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void open(manual);
        }}
      >
        <input
          className="flex-1 rounded border px-3 py-2 text-lg"
          inputMode="text"
          placeholder="운송장번호"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          aria-label="운송장번호"
        />
        <Button type="submit" disabled={openingState}>
          조회
        </Button>
      </form>
      {notice !== null && <p role="alert">{notice}</p>}
      {printGate !== null && (
        <section
          role="alert"
          className="space-y-2 rounded border border-amber-400 px-3 py-2"
        >
          <p className="font-medium">{printGate.message}</p>
          {printGate.changes.length > 0 && (
            <ul className="text-sm">
              {printGate.changes.map((c) => (
                <li key={`${c.locationCode}-${c.skuId}`}>
                  [{c.locationCode}] {c.name} {c.printedQty}개 → {c.currentQty}개
                </li>
              ))}
            </ul>
          )}
          <ReprintLabelButton
            shipmentId={printGate.shipmentId}
            prefs={prefs}
            print={print}
          />
        </section>
      )}

      {resume !== null && (
        <section className="space-y-1 rounded border border-blue-300 px-3 py-2">
          <p className="text-sm font-medium">하던 작업 이어서</p>
          <p>
            {resume.carrier} {resume.trackingNo}
          </p>
          <Button onClick={resumeWork} disabled={openingState}>
            이어서 작업
          </Button>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-neutral-500">진행 중인 배치</h2>
        {picking.data?.length === 0 && created.data?.length === 0 && (
          <p className="text-sm text-neutral-400">진행 중인 배치가 없어요.</p>
        )}
        <ul className="space-y-1">
          {batches.map((batch) => (
            <li key={batch.id} className="rounded border px-3 py-2">
              <p className="font-medium">{batch.batchNumber}</p>
              <p className="text-sm text-neutral-500">
                {batch.totalItems}박스 · {batch.totalQty}개
              </p>
              {batch.withdrawingItems > 0 && (
                <p className="text-sm text-amber-700">빠지는 중 {batch.withdrawingItems}</p>
              )}
              {batch.startedAt === null ? (
                <StartBatchButton batchId={batch.id} />
              ) : (
                <div className="flex flex-wrap gap-2">
                  {labelPrinting && (
                    <BatchLabelPrintButton
                      batchId={batch.id}
                      prefs={prefs}
                      print={print}
                      disabled={
                        printingBatch !== null && printingBatch !== batch.id
                      }
                      onRunningChange={(running) =>
                        onLabelRunChange(batch.id, running)
                      }
                    />
                  )}
                  <Button
                    type="button"
                    onClick={() => setPanel({ kind: 'join', batchId: batch.id })}
                  >
                    박스 넣기
                  </Button>
                  <Button
                    type="button"
                    onClick={() => setPanel({ kind: 'remove', batchId: batch.id })}
                  >
                    박스 빼기
                  </Button>
                </div>
              )}
              {panel?.kind === 'join' && panel.batchId === batch.id && (
                <JoinBoxPanel
                  batchId={batch.id}
                  prefs={prefs}
                  print={print}
                  labelPrinting={labelPrinting}
                  onClose={() => setPanel(null)}
                />
              )}
              {panel?.kind === 'remove' && panel.batchId === batch.id && (
                <RemoveBoxPanel
                  batchId={batch.id}
                  onClose={() => setPanel(null)}
                />
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function OutboundQueueScreen(
  props: Parameters<typeof OutboundQueueContent>[0]
) {
  return (
    <WorkArea kind="outbound">
      <OutboundQueueContent {...props} />
    </WorkArea>
  );
}
