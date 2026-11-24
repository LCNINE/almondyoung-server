import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import { localStoragePrefs, type DevicePrefs } from '../../core/data/devicePrefs';
import { Button } from '../../core/design/Button';
import { printRaw, readLabelPrinter, type PrintRaw } from '../../core/hardware/print/labelPrinter';
import { isStationDevice } from '../../app/station';
import { batchNameOf } from '../outbound/batchStatus';
import type { JoinOutcome } from '../outbound/batchJoin';
import { JoinOutcomeView } from '../outbound/JoinOutcomeView';
import { printReadyShipmentIntoBatch } from '../outbound/printIntoBatch';
import { useOutboundBatches } from '../outbound/queries';
import { READY_SHIPMENTS_KEY, useReadyShipments, type ReadyShipment } from './readyShipments';

const NO_BATCH = '진행 중인 배치가 없어요. 출고작업에서 배치를 시작해 주세요.';

function startedLabel(startedAt: string): string {
  const date = new Date(startedAt);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/**
 * 입고가 완성시킨 상자(«미발송 주문»). 갖춘 상자는 [송장 출력] → 시작한 배치 고르기 → 계획·합류·출력.
 * 보일 게 없으면 칸을 그리지 않는다.
 */
export function ReadyShipmentsSection({
  warehouseId,
  receiptLineIds,
  prefs = localStoragePrefs,
  print = printRaw,
  labelPrinting = isStationDevice(),
}: {
  warehouseId: string | null;
  receiptLineIds: readonly string[];
  prefs?: DevicePrefs;
  print?: PrintRaw;
  labelPrinting?: boolean;
}) {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const ready = useReadyShipments(warehouseId, receiptLineIds);
  const [pickingFor, setPickingFor] = useState<ReadyShipment | null>(null);
  const [outcome, setOutcome] = useState<JoinOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  // state 는 다음 렌더에야 보인다 — 같은 틱의 연타로 송장을 두 장 뽑지 않게 ref 로 막는다.
  const running = useRef(false);

  const picking = useOutboundBatches(pickingFor ? warehouseId : null, 'picking');
  const created = useOutboundBatches(pickingFor ? warehouseId : null, 'created');
  const loadingBatches = picking.isPending || created.isPending;
  const batchesFailed = picking.isError || created.isError;
  const startedBatches = [...(picking.data ?? []), ...(created.data ?? [])].filter(
    (batch, index, all) => batch.startedAt !== null && all.findIndex((b) => b.id === batch.id) === index,
  );

  const run = async (batchId: string) => {
    if (running.current || !pickingFor) return;
    running.current = true;
    setBusy(true);
    try {
      const result = await printReadyShipmentIntoBatch(
        { api, print, printer: labelPrinting ? readLabelPrinter(prefs) : null, newKey: () => crypto.randomUUID() },
        batchId,
        pickingFor,
      );
      setOutcome(result);
      setPickingFor(null);
      if (result.kind === 'joined') {
        await queryClient.invalidateQueries({ queryKey: ['outbound-batches'] });
        await queryClient.invalidateQueries({ queryKey: ['waybill-label-states'] });
      }
      await queryClient.invalidateQueries({ queryKey: [READY_SHIPMENTS_KEY] });
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  if (ready.items.length === 0 && ready.waitingOnOtherSkus === 0 && outcome === null) return null;

  return (
    <section className="space-y-2">
      {ready.items.length > 0 && (
        <div className="space-y-1">
          <p className="text-sm font-medium">미발송 주문</p>
          <ul className="space-y-1">
            {ready.items.map((shipment) => (
              <li key={shipment.shipmentId} className="flex items-center justify-between gap-2 rounded border px-3 py-2">
                <span className="text-sm">
                  #{shipment.orderNos[0]} {shipment.recipientMasked} 상품 {shipment.skuCount}종 {shipment.totalQty}개
                </span>
                {shipment.readiness === 'putaway_required' ? (
                  <span className="text-xs text-gray-500">적치하면 나갈 수 있어요</span>
                ) : (
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setOutcome(null);
                      setPickingFor(shipment);
                      // 이미 열려 있으면 다시 읽는다 — 못 읽은 배치 목록을 이 버튼으로 다시 시도한다
                      if (pickingFor !== null) {
                        void picking.refetch();
                        void created.refetch();
                      }
                    }}
                  >
                    송장 출력
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {pickingFor !== null && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">#{pickingFor.orderNos[0]} — 배치 고르기</p>
          <Button
            type="button"
            className="border border-gray-300 bg-white text-gray-700"
            disabled={busy}
            onClick={() => setPickingFor(null)}
          >
            닫기
          </Button>
        </div>
      )}
      {pickingFor !== null && batchesFailed && <p className="text-sm">배치 목록을 불러오지 못했어요.</p>}
      {pickingFor !== null && !loadingBatches && !batchesFailed && startedBatches.length === 0 && (
        <p className="text-sm">{NO_BATCH}</p>
      )}
      {pickingFor !== null && startedBatches.length > 0 && (
        <ul aria-label="배치 고르기" className="space-y-1">
          {startedBatches.map((batch) => (
            <li key={batch.id}>
              <Button
                type="button"
                className="w-full border border-gray-300 bg-white text-left text-gray-700"
                disabled={busy}
                onClick={() => void run(batch.id)}
              >
                {batchNameOf(batch) ?? batch.batchNumber}
                {batch.totalBoxes !== undefined ? ` · 상자 ${batch.totalBoxes}개` : ''}
                {batch.startedAt ? ` · ${startedLabel(batch.startedAt)}` : ''}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <JoinOutcomeView outcome={outcome} labelPrinting={labelPrinting} prefs={prefs} print={print} />
      {ready.waitingOnOtherSkus > 0 && (
        <p className="text-xs text-amber-700">다른 상품을 기다리는 주문 {ready.waitingOnOtherSkus}건</p>
      )}
    </section>
  );
}
