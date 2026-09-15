import { useEffect, useRef, useState } from 'react';
import { useWarehouse } from '../../app/warehouse-context';
import { WorkArea } from '../../core/operations/WorkBoundary';
import { useUnsavedWork } from '../../core/operations/useUnsavedWork';
import { useApiClient } from '../../core/data/ApiClientProvider';
import { errorMessage } from '../../core/data/errorMessage';
import { Button } from '../../core/design/Button';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { WarehousePicker } from '../warehouse/WarehousePicker';
import { SkuPicker, type SelectedSku } from '../inventory/SkuPicker';
import { useCancelInbound, useCancelPurchaseOrderReceipt } from './mutations';
import {
  ReceiptHistoryError,
  recentReceiptDates,
  receiptHistoryPath,
  useReceiptHistory,
  validateReceiptHistory,
  type ReceiptHistoryResult,
  type ReceiptHistoryLine,
  type ReceiptStatus,
} from './receiptHistory';
const reasons: Record<string, string> = {
  ALREADY_CANCELED: '취소됨',
  NOT_TODAY: '당일 입고만 취소 가능',
  PUTAWAY_EXISTS: '이미 적치한 입고',
  RETURN_EXISTS: '이미 회송한 입고',
  INSUFFICIENT_ORIGIN_STOCK: '원위치 재고 부족',
  MISSING_ORIGIN_OR_EVENT: '원입고 정보 확인 필요',
};
function HistoryContent({
  warehouseId,
  warehouseName,
}: {
  warehouseId: string;
  warehouseName: string;
}) {
  const api = useApiClient();
  const [dates, setDates] = useState(() => recentReceiptDates());
  const [status, setStatus] = useState<ReceiptStatus>('all');
  const [sku, setSku] = useState<SelectedSku | null>(null);
  const [offset, setOffset] = useState(0);
  const params = {
    warehouseId,
    ...dates,
    status,
    skuId: sku?.id,
    limit: 20,
    offset,
  };
  const query = useReceiptHistory(params);
  const signature = JSON.stringify({ ...params, offset: 0 });
  const [shown, setShown] = useState<{
    signature: string;
    offset: number;
    data: ReceiptHistoryResult;
  } | null>(null);
  useEffect(() => {
    if (
      query.data &&
      !query.isPlaceholderData &&
      !query.isError &&
      !query.isFetching
    )
      setShown({ signature, offset, data: query.data });
  }, [
    query.data,
    query.isPlaceholderData,
    query.isError,
    query.isFetching,
    signature,
    offset,
  ]);
  const data = shown?.signature === signature ? shown.data : null;
  const current =
    !!data &&
    shown?.offset === offset &&
    !query.isFetching &&
    !query.isError &&
    !query.isPlaceholderData;
  const direct = useCancelInbound(),
    po = useCancelPurchaseOrderReceipt();
  const [selection, setSelection] = useState<{
    receiptId: string;
    line: ReceiptHistoryLine;
    key: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  useUnsavedWork(!!selection || busy);
  async function confirmCancel() {
    if (!selection || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const latest = await api.request<unknown>({
        path: receiptHistoryPath({
          warehouseId,
          receiptId: selection.receiptId,
          status: 'all',
          limit: 1,
          offset: 0,
        }),
      });
      validateReceiptHistory(latest);
      const receipt = latest.items.find(
        (item) =>
          item.id === selection.receiptId && item.warehouseId === warehouseId
      );
      const line = receipt?.lines.find((item) => item.id === selection.line.id);
      if (
        !line?.canCancel ||
        line.quantity !== selection.line.quantity ||
        line.source !== selection.line.source
      )
        throw new ReceiptHistoryError(
          '입고 상태가 바뀌었어요. 최신 내역을 확인해 주세요.'
        );
      if (line.source === 'purchase_order')
        await po.mutateAsync({
          receiptLineId: line.id,
          idempotencyKey: selection.key,
        });
      else
        await direct.mutateAsync({
          lineId: line.id,
          quantity: line.quantity,
          idempotencyKey: selection.key,
        });
      setNotice('입고를 취소했어요.');
    } catch (error) {
      setNotice(
        error instanceof ReceiptHistoryError
          ? error.message
          : errorMessage(error, 'inbound')
      );
    } finally {
      setSelection(null);
      await query.refetch();
      busyRef.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4">
      <ScreenHeader title="입고내역" backTo="/inbound" />
      <p>
        {warehouseName} · 서울 기준 {dates.startDate} ~ {dates.endDate} ·{' '}
        {status === 'all'
          ? '전체'
          : status === 'posted'
            ? '입고 완료'
            : '취소됨'}
      </p>
      <fieldset
        disabled={busy || !!selection}
        className="space-y-3 rounded-lg border p-3"
      >
        <div className="flex flex-wrap gap-3">
          <label>
            시작일
            <input
              aria-label="시작일"
              type="date"
              value={dates.startDate}
              max={dates.endDate}
              onChange={(e) => {
                setDates({ ...dates, startDate: e.target.value });
                setOffset(0);
              }}
            />
          </label>
          <label>
            종료일
            <input
              aria-label="종료일"
              type="date"
              value={dates.endDate}
              min={dates.startDate}
              onChange={(e) => {
                setDates({ ...dates, endDate: e.target.value });
                setOffset(0);
              }}
            />
          </label>
          <label>
            입고 상태
            <select
              aria-label="입고 상태"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as ReceiptStatus);
                setOffset(0);
              }}
            >
              <option value="all">전체</option>
              <option value="posted">입고 완료</option>
              <option value="voided">취소됨</option>
            </select>
          </label>
        </div>
        <SkuPicker
          onSelect={(next) => {
            setSku(next);
            setOffset(0);
          }}
        />
        {sku && (
          <p>
            {sku.name}{' '}
            <Button
              onClick={() => {
                setSku(null);
                setOffset(0);
              }}
            >
              상품 필터 해제
            </Button>
          </p>
        )}
      </fieldset>
      {notice && <p role="status">{notice}</p>}
      {query.isFetching && <p role="status">입고내역을 확인하고 있어요.</p>}
      {query.isError && (
        <p role="alert">
          입고내역을 불러오지 못했어요.{' '}
          {query.error instanceof ReceiptHistoryError
            ? query.error.message
            : errorMessage(query.error, 'inbound')}{' '}
          <Button onClick={() => void query.refetch()}>다시 확인</Button>
        </p>
      )}
      {data && (
        <>
          <p>
            {data.total}건 · {Math.floor((shown?.offset ?? 0) / 20) + 1}페이지
          </p>
          {data.items.length === 0 && !query.isError ? (
            <p>입고내역이 없어요.</p>
          ) : (
            <ul className="space-y-4">
              {data.items.map((receipt) => (
                <li
                  key={receipt.id}
                  className="space-y-2 rounded-lg border bg-white p-4"
                >
                  <div className="flex flex-wrap justify-between gap-2">
                    <time>
                      {new Date(receipt.occurredAt).toLocaleString('ko-KR', {
                        timeZone: 'Asia/Seoul',
                      })}
                    </time>
                    <span>
                      {receipt.status === 'voided' ? '취소됨' : '입고 완료'} ·
                      총 {receipt.totalQuantity}개
                    </span>
                  </div>
                  <ul className="space-y-2">
                    {receipt.lines.map((line) => (
                      <li key={line.id} className="rounded border p-3">
                        <p className="font-semibold">
                          {line.skuName}{' '}
                          <span className="font-mono text-sm">
                            {line.skuCode}
                          </span>
                        </p>
                        <p>
                          {line.source === 'purchase_order'
                            ? '발주입고'
                            : '직접입고'}{' '}
                          · 원위치 {line.originLocationCode ?? '확인 필요'}
                        </p>
                        <p>
                          입고 {line.quantity}개 · 적치{' '}
                          {line.putawayFromOriginQty}개 · 취소{' '}
                          {line.canceledQty}개 · 회송 {line.returnedQty}개
                        </p>
                        {line.canCancel && current ? (
                          <Button
                            aria-label={`${line.skuName} 입고 취소`}
                            disabled={busy || !!selection}
                            onClick={() =>
                              setSelection({
                                receiptId: receipt.id,
                                line,
                                key: crypto.randomUUID(),
                              })
                            }
                          >
                            입고 취소
                          </Button>
                        ) : line.cancelBlockReason ? (
                          <p className="text-sm text-gray-600">
                            {reasons[line.cancelBlockReason] ??
                              '취소 가능 상태 확인 필요'}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <Button
              disabled={
                busy ||
                !!selection ||
                query.isFetching ||
                (shown?.offset ?? 0) === 0
              }
              onClick={() => setOffset(Math.max(0, (shown?.offset ?? 0) - 20))}
            >
              이전
            </Button>
            <Button
              disabled={
                busy ||
                !!selection ||
                query.isFetching ||
                (shown?.offset ?? 0) + 20 >= data.total
              }
              onClick={() => setOffset((shown?.offset ?? 0) + 20)}
            >
              다음
            </Button>
          </div>
        </>
      )}
      {selection && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-label="입고 취소 확인"
            className="w-full max-w-md space-y-3 rounded-xl bg-white p-5"
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.preventDefault();
            }}
          >
            <h2 className="font-semibold">입고 취소 확인</h2>
            <p>
              {warehouseName} / {selection.line.originLocationCode}의{' '}
              {selection.line.skuName} {selection.line.quantity}개를 전량
              취소합니다.
            </p>
            {selection.line.source === 'purchase_order' && (
              <p>발주 미입고 수량이 복원됩니다.</p>
            )}
            <Button disabled={busy} onClick={() => setSelection(null)}>
              돌아가기
            </Button>
            <Button disabled={busy} onClick={() => void confirmCancel()}>
              전량 취소
            </Button>
          </section>
        </div>
      )}
    </div>
  );
}
export function InboundHistoryScreen() {
  const { warehouseId, warehouseName } = useWarehouse();
  return (
    <WorkArea kind="inbound">
      {warehouseId ? (
        <HistoryContent
          key={warehouseId}
          warehouseId={warehouseId}
          warehouseName={warehouseName ?? '선택 창고'}
        />
      ) : (
        <>
          <ScreenHeader title="입고내역" backTo="/inbound" />
          <WarehousePicker />
        </>
      )}
    </WorkArea>
  );
}
