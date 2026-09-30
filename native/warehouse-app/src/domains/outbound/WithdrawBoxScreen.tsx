import { useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useWarehouse } from '../../app/warehouse-context';
import { useApiClient } from '../../core/data/ApiClientProvider';
import { localStoragePrefs, type DevicePrefs } from '../../core/data/devicePrefs';
import { errorMessage } from '../../core/data/errorMessage';
import { ApiError } from '../../core/data/httpClient';
import { Button } from '../../core/design/Button';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { BarcodeInput } from '../../core/hardware/scan/BarcodeInput';
import { useScanner } from '../../core/hardware/scan/useScanner';
import { SCAN_STORAGE_MESSAGE, useWorkScanQueue } from '../../core/hardware/scan/useWorkScanQueue';
import { WorkArea } from '../../core/operations/WorkBoundary';
import { readReturnBin } from '../returns/returnBin';
import type { ShipmentByWaybill, WithdrawalRemoval } from './types';
import { removeToReturnBin, withdrawalRows } from './withdraw';

function WithdrawBoxContent({
  shipmentId,
  shipment,
  prefs = localStoragePrefs,
}: {
  shipmentId: string;
  shipment: ShipmentByWaybill | null;
  prefs?: DevicePrefs;
}) {
  const api = useApiClient();
  const { warehouseId } = useWarehouse();
  const bin = readReturnBin(prefs, warehouseId);
  const [removals, setRemovals] = useState<WithdrawalRemoval[]>(shipment?.removals ?? []);
  const [done, setDone] = useState(false);
  const doneRef = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  const queue = useWorkScanQueue<{ barcode: string; returnBinBarcode: string }>(
    async (input, id) => {
      if (doneRef.current) return;
      try {
        const result = await removeToReturnBin(api, { shipmentId, ...input, idempotencyKey: id });
        setNotice(null);
        setRemovals(result.removals);
        if (result.exited) {
          doneRef.current = true;
          setDone(true);
        }
      } catch (error) {
        setNotice(errorMessage(error, 'outbound'));
        if (!(error instanceof ApiError && error.outcome === 'rejected')) throw error;
      }
    },
    `withdraw:${shipmentId}`,
  );
  const accept = (barcode: string) => {
    if (!bin || doneRef.current) return;
    queue.enqueue({ barcode, returnBinBarcode: bin });
  };
  useScanner((event) => accept(event.code));

  if (!shipment) {
    return (
      <div className="space-y-4">
        <ScreenHeader title="박스 빼기" backTo="/outbound" />
        <p role="alert">송장 정보를 잃었어요. 송장을 다시 스캔해 주세요.</p>
      </div>
    );
  }
  const rows = withdrawalRows(removals);
  return (
    <div className="space-y-4">
      <ScreenHeader title="박스 빼기" backTo="/outbound" />
      <section className="rounded border px-3 py-2">
        <p className="font-medium">
          {shipment.carrier} {shipment.trackingNo}
        </p>
        <p className="text-sm text-neutral-500">배치에서 빠지는 박스예요. 뺄 상품을 스캔해 되돌림 바구니에 넣어 주세요.</p>
        {bin && <p className="text-sm">바구니: {bin}</p>}
      </section>
      {!bin && (
        <p role="alert">
          설정에서 이 기기의 되돌림 바구니를 먼저 지정해 주세요. <Link to="/settings">설정 열기</Link>
        </p>
      )}
      {done ? (
        <p role="status">다 뺐어요. 이 박스의 송장은 버려 주세요.</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((row) => (
            <li key={row.key} className="flex items-center justify-between rounded border px-3 py-2">
              <span>
                {row.label}
                {row.onCart && <span className="block text-xs text-neutral-500">카트에 실린 몫 — 분류대에서 빼요</span>}
              </span>
              <span className="text-lg font-semibold">{row.qty}개</span>
            </li>
          ))}
        </ul>
      )}
      {notice !== null && <p role="alert">{notice}</p>}
      {queue.storageError() ? <p role="alert">{SCAN_STORAGE_MESSAGE}</p> : null}
      {queue.error() ? <Button onClick={() => void queue.retryHead().catch(() => {})}>처리 내역 확인</Button> : null}
      {!done && bin && <BarcodeInput label="상품 바코드" onSubmit={accept} />}
      {done && (
        <Link to="/outbound">
          <Button>출고작업으로</Button>
        </Link>
      )}
    </div>
  );
}

export function WithdrawBoxScreen(props: Parameters<typeof WithdrawBoxContent>[0]) {
  return (
    <WorkArea kind="outbound">
      <WithdrawBoxContent {...props} />
    </WorkArea>
  );
}
