import { useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useApiClient } from '../../core/data/ApiClientProvider';
import { errorMessage } from '../../core/data/errorMessage';
import { ApiError } from '../../core/data/httpClient';
import { Button } from '../../core/design/Button';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { BarcodeInput } from '../../core/hardware/scan/BarcodeInput';
import { useScanner } from '../../core/hardware/scan/useScanner';
import { SCAN_STORAGE_MESSAGE, useWorkScanQueue } from '../../core/hardware/scan/useWorkScanQueue';
import { WorkArea } from '../../core/operations/WorkBoundary';
import { isReturnBinCode } from '../returns/returnBin';
import type { ShipmentByWaybill, WithdrawalRemoval } from './types';
import { removeToReturnBin, withdrawalRows } from './withdraw';

const ALREADY_EXITED_NOTICE = '이미 다 뺀 박스예요 — 이 상품은 바구니에 넣지 마세요.';

function WithdrawBoxContent({
  shipmentId,
  shipment,
}: {
  shipmentId: string;
  shipment: ShipmentByWaybill | null;
}) {
  const api = useApiClient();
  const [removals, setRemovals] = useState<WithdrawalRemoval[]>(shipment?.removals ?? []);
  const [done, setDone] = useState(false);
  const [exitTo, setExitTo] = useState<ShipmentByWaybill['exitTo']>(null);
  const doneRef = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  const queue = useWorkScanQueue<{ barcode: string }>(
    async (input, id) => {
      // 박스를 내보낸 스캔 뒤에 줄 서 있던 스캔 — 보내지 않되, 손에 든 상품을 바구니에 넣지 않게 새 스캔과 같이 알린다.
      if (doneRef.current) {
        setNotice(ALREADY_EXITED_NOTICE);
        return;
      }
      try {
        const result = await removeToReturnBin(api, { shipmentId, ...input, idempotencyKey: id });
        setNotice(null);
        setRemovals(result.removals);
        if (result.exited) {
          doneRef.current = true;
          setExitTo(result.exitTo ?? null);
          setDone(true);
        }
      } catch (error) {
        setNotice(errorMessage(error, 'outbound'));
        if (!(error instanceof ApiError && error.outcome === 'rejected')) throw error;
      }
    },
    `withdraw:${shipmentId}`,
  );
  const rows = withdrawalRows(removals);
  const cartOnly = rows.length > 0 && rows.every((row) => row.onCart);
  const accept = (barcode: string) => {
    if (!shipment) return;
    if (doneRef.current) {
      setNotice(ALREADY_EXITED_NOTICE);
      return;
    }
    // 앞 스캔의 결과를 모르는 채 같은 상품을 또 찍으면 한 개가 두 번 빠진다 — 확인이 끝날 때까지 새 스캔을 받지 않는다.
    if (queue.error()) return;
    if (isReturnBinCode(barcode)) {
      setNotice('바구니 바코드예요 — 뺄 상품을 찍어 주세요.');
      return;
    }
    if (cartOnly) {
      setNotice('박스에서 뺄 상품은 없어요. 카트 몫은 분류대에서 빠져요.');
      return;
    }
    queue.enqueue({ barcode });
  };
  useScanner((event) => accept(event.code));

  const queueStatus = (
    <>
      {queue.storageError() ? (
        <p role="alert">{SCAN_STORAGE_MESSAGE}</p>
      ) : queue.error() ? (
        <p role="alert">
          앞의 스캔이 처리됐는지 확인하지 못했어요. 같은 상품을 다시 찍지 말고 처리 내역 확인을 눌러 주세요.
        </p>
      ) : notice !== null ? (
        <p role="alert">{notice}</p>
      ) : null}
      {queue.error() ? <Button onClick={() => void queue.retryHead().catch(() => {})}>처리 내역 확인</Button> : null}
    </>
  );

  if (!shipment) {
    return (
      <div className="space-y-4">
        <ScreenHeader title="박스 빼기" backTo="/outbound" />
        <p role="alert">송장 정보를 잃었어요. 송장을 다시 스캔해 주세요.</p>
        {queueStatus}
        <Link to="/outbound">
          <Button>출고작업으로</Button>
        </Link>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <ScreenHeader title="박스 빼기" backTo="/outbound" />
      <section className="rounded border px-3 py-2">
        <p className="font-medium">
          {shipment.carrier} {shipment.trackingNo}
        </p>
        <p className="text-sm text-neutral-500">배치에서 빠지는 박스예요. 뺄 상품을 스캔해 되돌림 바구니에 넣어 주세요.</p>
      </section>
      {done ? (
        <div className="space-y-1">
          <p role="status">다 뺐어요. 이 박스의 송장은 버려 주세요.</p>
          <p className="text-sm text-neutral-500">꺼낸 상품은 되돌림 적치에서 원래 자리에 넣어 주세요.</p>
          {exitTo === 'canceled' ? (
            <p className="text-sm text-neutral-500">이 상자의 주문은 취소됐어요. 다시 보내지 않아요.</p>
          ) : exitTo === 'draft' ? (
            <p className="text-sm text-neutral-500">이 상자의 주문은 관리자가 «출고 준비»에서 다시 준비해요.</p>
          ) : null}
        </div>
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
      {cartOnly && !done && (
        <p role="status">박스에서 뺄 상품은 다 뺐어요. 남은 건 카트에 실린 몫이라 분류대에서 빠져요.</p>
      )}
      {queueStatus}
      {!done && !cartOnly && <BarcodeInput label="상품 바코드" onSubmit={accept} />}
      {done ? (
        <div className="flex gap-2">
          <Link to="/returns/putaway">
            <Button>되돌림 적치</Button>
          </Link>
          <Link to="/outbound">
            <Button className="border border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-100">출고작업으로</Button>
          </Link>
        </div>
      ) : null}
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
