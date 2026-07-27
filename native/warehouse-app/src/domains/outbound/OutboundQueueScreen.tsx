import { useState } from 'react';
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
import { WarehousePicker } from '../warehouse/WarehousePicker';
import { readLastBox, writeLastBox } from './lastBox';
import { useOutboundBatches, useShipmentByWaybill } from './queries';

export function OutboundQueueScreen({
  prefs = localStoragePrefs,
}: {
  prefs?: DevicePrefs;
}) {
  const { warehouseId, isSet } = useWarehouse();
  const navigate = useNavigate();
  const [notice, setNotice] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const [resume] = useState(() => readLastBox(prefs));
  const lookup = useShipmentByWaybill();
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

  const open = (trackingNo: string) => {
    const code = trackingNo.trim();
    if (!code) return;
    setNotice(null);
    lookup.mutate(code, {
      onSuccess: (found) => {
        setManual('');
        // 배치의 눈으로 이미 알 수 있는 문제는 첫 상품 스캔까지 미루지 않는다 —
        // 조회 시점에 안내하고 큐 화면에 남는다.
        if (found.workItemId === null) {
          setNotice('이 송장은 오늘 배치에 없어요 — 관리자에게 문의해 주세요');
          return;
        }
        if (found.shipmentStatus === 'shipped') {
          setNotice('이미 출고된 송장이에요');
          return;
        }
        writeLastBox(prefs, found);
        void navigate({
          to: '/outbound/simple/$shipmentId',
          params: { shipmentId: found.shipmentId },
          state: { shipment: found },
        });
      },
      onError: (error) => setNotice(errorMessage(error, 'outbound')),
    });
  };

  useScanner((event) => open(event.code));

  // 기기에 남은 건 마지막으로 열었던 스냅샷일 뿐이다 — 그 사이 다른 작업자가 더
  // 스캔했을 수 있으니 재개 시 항상 다시 조회한다. 실패하면 일반 스캔과 같은 안내를 쓴다.
  const resumeWork = () => {
    if (resume) open(resume.trackingNo);
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
          open(manual);
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
        <Button type="submit" disabled={lookup.isPending}>
          조회
        </Button>
      </form>
      {notice !== null && <p role="alert">{notice}</p>}

      {resume !== null && (
        <section className="space-y-1 rounded border border-blue-300 px-3 py-2">
          <p className="text-sm font-medium">하던 작업 이어서</p>
          <p>
            {resume.carrier} {resume.trackingNo}
          </p>
          <Button onClick={resumeWork} disabled={lookup.isPending}>
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
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
