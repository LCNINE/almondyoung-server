import {
  CancelReceiptDialog,
  type CancelReceiptTarget,
} from './CancelReceiptDialog';
import { useWorkCapabilities } from '../../core/operations/useWorkCapabilities';
import { useWorkRuntime } from '../../core/operations/OperationContext';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { isStationDevice } from '../../app/station';
import { useWarehouse } from '../../app/warehouse-context';
import { WorkArea } from '../../core/operations/WorkBoundary';
import { useUnsavedWork } from '../../core/operations/useUnsavedWork';
import { errorMessage } from '../../core/data/errorMessage';
import { Button } from '../../core/design/Button';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { WarehousePicker } from '../warehouse/WarehousePicker';
import { SaveToast, useSaveToast } from './SaveToast';
import { SkuPicker, type SelectedSku } from '../inventory/SkuPicker';
import { PUTAWAY_FIX_BY_COUNT } from './cancelReceipt';
import {
  ReceiptHistoryError,
  recentReceiptDates,
  useReceiptHistory,
  type ReceiptHistoryResult,
  type ReceiptStatus,
} from './receiptHistory';
const reasons: Record<string, string> = {
  ALREADY_CANCELED: '취소됨',
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
  const capabilities = useWorkCapabilities();
  const runtime = useWorkRuntime();
  const supported =
    !!runtime &&
    capabilities.isSuccess &&
    capabilities.data.inboundWorkflowConsistency === true;
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
  const [selection, setSelection] = useState<CancelReceiptTarget | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const toast = useSaveToast();
  useUnsavedWork(!!selection);
  return (
    <div className="space-y-4">
      <ScreenHeader title="입고내역" backTo="/inbound" />
      {!supported && (
        <p role="alert">앱과 서버 업데이트를 확인한 뒤 다시 시도해 주세요.</p>
      )}
      <p>
        {warehouseName} · 서울 기준 {dates.startDate} ~ {dates.endDate} ·{' '}
        {status === 'all'
          ? '전체'
          : status === 'posted'
            ? '입고 완료'
            : '취소됨'}
      </p>
      <fieldset
        disabled={!!selection}
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
      <SaveToast toast={toast.toast} />
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
                            : line.source === 'inbound_shipment'
                              ? '선적입고'
                              : '직접입고'}{' '}
                          · 원위치 {line.originLocationCode ?? '확인 필요'}
                        </p>
                        <p>
                          입고 {line.quantity}개 · 적치{' '}
                          {line.putawayFromOriginQty}개 · 취소{' '}
                          {line.canceledQty}개 · 회송 {line.returnedQty}개
                        </p>
                        {line.source === 'inbound_shipment' ? (
                          <>
                            {line.inboundShipmentBox &&
                              (isStationDevice() ? (
                                <p>
                                  <Link
                                    to="/inbound/boxes"
                                    search={{
                                      shipmentId:
                                        line.inboundShipmentBox.shipmentId,
                                      boxId: line.inboundShipmentBox.boxId,
                                    }}
                                    className="underline"
                                  >
                                    {line.inboundShipmentBox.shipmentName} ·
                                    상자 {line.inboundShipmentBox.boxLabel}
                                  </Link>
                                </p>
                              ) : (
                                <p>
                                  {line.inboundShipmentBox.shipmentName} · 상자{' '}
                                  {line.inboundShipmentBox.boxLabel}
                                </p>
                              ))}
                            {!isStationDevice() && (
                              <p className="text-sm text-gray-600">
                                스테이션에서 취소해요
                              </p>
                            )}
                          </>
                        ) : line.canCancel && current ? (
                          <Button
                            aria-label={`${line.skuName} 입고 취소`}
                            disabled={!!selection || !supported}
                            onClick={() =>
                              setSelection({
                                lineId: line.id,
                                source: line.source,
                                skuName: line.skuName,
                                originLocationCode: line.originLocationCode,
                                receivedAt: receipt.occurredAt,
                              })
                            }
                          >
                            입고 취소
                          </Button>
                        ) : line.cancelBlockReason ? (
                          <p className="text-sm text-gray-600">
                            {reasons[line.cancelBlockReason] ??
                              '취소 가능 상태 확인 필요'}
                            {line.cancelBlockReason === 'PUTAWAY_EXISTS' && (
                              <span className="block text-xs text-gray-500">
                                수량이 틀렸다면 {PUTAWAY_FIX_BY_COUNT}
                              </span>
                            )}
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
                !!selection || query.isFetching || (shown?.offset ?? 0) === 0
              }
              onClick={() => setOffset(Math.max(0, (shown?.offset ?? 0) - 20))}
            >
              이전
            </Button>
            <Button
              disabled={
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
        <CancelReceiptDialog
          target={selection}
          warehouseId={warehouseId}
          onClose={() => setSelection(null)}
          onFinished={(outcome) => {
            if (outcome.ok) toast.show({ kind: 'cancelled', detail: outcome.detail });
            else setNotice(outcome.notice);
            setSelection(null);
            void query.refetch();
          }}
        />
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
