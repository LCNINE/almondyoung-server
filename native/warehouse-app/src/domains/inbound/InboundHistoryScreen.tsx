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
  type ReceiptHistoryLine,
} from './receiptHistory';
import { cn } from '../../core/design/cn';
import { InboundTabs } from './InboundTabs';
import type { ReceiptSource } from './types';

const SOURCE: Record<ReceiptSource, string> = {
  direct: '직접입고',
  purchase_order: '발주입고',
  inbound_shipment: '선적입고',
};

const TH = 'px-5 py-3 max-[900px]:px-2.5';
const TD = 'px-5 py-3.5 align-middle max-[900px]:px-2.5';
const PILL =
  'inline-flex items-center rounded-[5px] px-2 py-[5px] text-[11px] font-semibold whitespace-nowrap';
const UNAVAILABLE = 'text-[11px] whitespace-nowrap text-[#8b8b95]';
const SMALL_BUTTON =
  'border border-[#e4e4e7] bg-white px-2.5 py-[7px] text-xs text-[#27272a] hover:bg-[#eff6ff] hover:brightness-100';
const OUTLINE_BUTTON =
  'border border-[#e4e4e7] bg-white text-[#27272a] hover:bg-[#eff6ff] hover:brightness-100';
const FILTER_LABEL = 'flex items-center gap-2.5 text-xs text-[#71717a]';
const FILTER_INPUT =
  'rounded-lg border border-[#e4e4e7] bg-white px-3 py-2.5 text-xs text-[#27272a]';
const NOTE_BOX =
  'rounded-[10px] border border-[#e4e4e7] bg-white px-4 py-3 text-[13px] text-[#27272a]';
const ERROR_BOX =
  'rounded-[10px] border border-[#efcbc4] bg-[#fff4f1] px-4 py-3 text-[13px] text-[#aa4037]';

function numCell(canceled: boolean) {
  return cn(TD, 'text-right', canceled ? 'text-[#8b8b95]' : 'text-[#27272a]');
}

function receiptTime(iso: string) {
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';

  return {
    date: `${part('year')}.${part('month')}.${part('day')}`,
    time: `${part('hour')}:${part('minute')}`,
  };
}

function lineState(line: ReceiptHistoryLine) {
  const open = line.quantity - line.canceledQty - line.returnedQty;

  if (line.canceledQty > 0 && line.canceledQty >= line.quantity)
    return '취소 완료';

  if (line.putawayFromOriginQty > 0 && line.putawayFromOriginQty >= open)
    return '적치 완료';

  if (line.putawayFromOriginQty > 0) return '일부 적치';

  if (open <= 0) return '회송 완료';

  return '적치 대기';
}

function HistoryHeader() {
  return (
    <ScreenHeader
      title="입고내역"
      backTo="/inbound"
      description="상품별 입고·적치·취소 수량을 확인하세요."
      right={<InboundTabs active="history" />}
    />
  );
}

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
  const header = <HistoryHeader />;

  return (
    <div className="space-y-[22px]">
      {header}
      {!supported && (
        <p role="alert" className={ERROR_BOX}>
          앱과 서버 업데이트를 확인한 뒤 다시 시도해 주세요.
        </p>
      )}
      <fieldset
        disabled={!!selection}
        className="space-y-3 rounded-xl border border-[#e4e4e7] bg-white px-[22px] py-[18px]"
      >
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
          <label className={FILTER_LABEL}>
            시작일
            <input
              aria-label="시작일"
              type="date"
              value={dates.startDate}
              max={dates.endDate}
              className={FILTER_INPUT}
              onChange={(e) => {
                setDates({ ...dates, startDate: e.target.value });
                setOffset(0);
              }}
            />
          </label>
          <label className={FILTER_LABEL}>
            종료일
            <input
              aria-label="종료일"
              type="date"
              value={dates.endDate}
              min={dates.startDate}
              className={FILTER_INPUT}
              onChange={(e) => {
                setDates({ ...dates, endDate: e.target.value });
                setOffset(0);
              }}
            />
          </label>
          <label className={FILTER_LABEL}>
            상태
            <select
              aria-label="입고 상태"
              value={status}
              className={FILTER_INPUT}
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
          <span className="ml-auto text-xs text-[#71717a]">
            {warehouseName} · 서울 기준 {dates.startDate} ~ {dates.endDate} ·{' '}
            {status === 'all'
              ? '전체'
              : status === 'posted'
                ? '입고 완료'
                : '취소됨'}
          </span>
        </div>
        <SkuPicker
          onSelect={(next) => {
            setSku(next);
            setOffset(0);
          }}
        />
        {sku && (
          <p className="flex flex-wrap items-center gap-2 text-[13px] text-[#27272a]">
            {sku.name}{' '}
            <Button
              className={SMALL_BUTTON}
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
      {notice && (
        <p role="status" className={NOTE_BOX}>
          {notice}
        </p>
      )}
      {query.isFetching && (
        <p role="status" className="text-[13px] text-[#71717a]">
          입고내역을 확인하고 있어요.
        </p>
      )}
      {query.isError && (
        <p role="alert" className={`flex flex-wrap items-center gap-2 ${ERROR_BOX}`}>
          입고내역을 불러오지 못했어요.{' '}
          {query.error instanceof ReceiptHistoryError
            ? query.error.message
            : errorMessage(query.error, 'inbound')}{' '}
          <Button className={SMALL_BUTTON} onClick={() => void query.refetch()}>
            다시 확인
          </Button>
        </p>
      )}
      {data && (
        <>
          <p className="text-xs text-[#71717a]">
            {data.total}건 · {Math.floor((shown?.offset ?? 0) / 20) + 1}페이지
          </p>
          {data.items.length === 0 && !query.isError ? (
            <p className="rounded-xl border border-[#e4e4e7] bg-white p-11 text-center text-[13px] text-[#71717a]">
              입고내역이 없어요.
            </p>
          ) : (
            <ul className="space-y-[18px]">
              {data.items.map((receipt) => {
                const when = receiptTime(receipt.occurredAt);
                const quantity = receipt.lines.reduce(
                  (sum, line) => sum + line.quantity,
                  0
                );
                const canceled = receipt.lines.reduce(
                  (sum, line) => sum + line.canceledQty,
                  0
                );
                const allCanceled =
                  receipt.status === 'voided' ||
                  (quantity > 0 && canceled >= quantity);
                const sources = [
                  ...new Set(receipt.lines.map((line) => SOURCE[line.source])),
                ].join(' · ');

                return (
                  <li
                    key={receipt.id}
                    aria-label={`${when.date} ${when.time} 입고내역`}
                    className="overflow-hidden rounded-xl border border-[#e4e4e7] bg-white"
                  >
                    <header className="flex flex-wrap items-center justify-between gap-[18px] border-b border-[#e4e4e7] px-[22px] py-[18px] max-[900px]:p-4">
                      <div>
                        <h3 className="text-base font-bold text-[#27272a] tabular-nums">
                          <time dateTime={receipt.occurredAt}>
                            {when.date}
                            <span className="ml-3 text-xs font-normal text-[#71717a]">
                              {when.time}
                            </span>
                          </time>
                        </h3>
                        <p className="mt-1.5 text-[11px] text-[#71717a]">
                          {warehouseName} · {sources}
                        </p>
                      </div>
                      <div className="flex items-center gap-[15px] text-xs text-[#71717a] max-[900px]:gap-2">
                        <span>
                          {receipt.lines.length}종 · 입고 {quantity}개
                          {canceled > 0 ? ` / 취소 ${canceled}개` : ''}
                        </span>
                        <span
                          className={cn(
                            PILL,
                            allCanceled
                              ? 'bg-[#eff1f2] text-[#68706d]'
                              : canceled > 0
                                ? 'bg-[#fff1d9] text-[#925e13]'
                                : 'bg-[#eff6ff] text-[#2563eb]'
                          )}
                        >
                          {allCanceled
                            ? '취소 완료'
                            : canceled > 0
                              ? '일부 취소'
                              : '입고 완료'}
                        </span>
                      </div>
                    </header>
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-[13px] tabular-nums max-[900px]:min-w-[740px]">
                        <thead>
                          <tr className="bg-[#fafafa] text-left text-[11px] font-medium whitespace-nowrap text-[#71717a]">
                            <th className={TH}>상품 / 옵션</th>
                            <th className={TH}>원위치</th>
                            <th className={`${TH} text-right`}>입고</th>
                            <th className={`${TH} text-right`}>적치</th>
                            <th className={`${TH} text-right`}>취소</th>
                            <th className={`${TH} text-right`}>회송</th>
                            <th className={TH}>상태</th>
                            <th className={`${TH} w-[145px]`}>입고 취소</th>
                          </tr>
                        </thead>
                        <tbody>
                          {receipt.lines.map((line) => (
                            <tr
                              key={line.id}
                              className={cn(
                                'border-t border-[#e4e4e7]',
                                line.canceledQty > 0 && 'bg-[#fafafa]'
                              )}
                            >
                              <td className={TD}>
                                <strong
                                  className={cn(
                                    'block text-[13px] leading-[1.5] font-semibold',
                                    line.canceledQty > 0
                                      ? 'text-[#8b8b95]'
                                      : 'text-[#27272a]'
                                  )}
                                >
                                  {line.skuName}
                                </strong>
                                <small className="mt-1 block text-[11px] text-[#71717a]">
                                  {SOURCE[line.source]} ·{' '}
                                  <span className="font-mono">
                                    {line.skuCode}
                                  </span>
                                </small>
                              </td>
                              <td className={`${TD} text-xs whitespace-nowrap`}>
                                {line.originLocationCode ?? '확인 필요'}
                              </td>
                              <td className={numCell(line.canceledQty > 0)}>
                                {line.quantity}
                              </td>
                              <td className={numCell(line.canceledQty > 0)}>
                                {line.putawayFromOriginQty}
                              </td>
                              <td
                                className={
                                  line.canceledQty > 0
                                    ? `${TD} text-right text-[#52525b]`
                                    : numCell(false)
                                }
                              >
                                {line.canceledQty}
                              </td>
                              <td className={numCell(line.canceledQty > 0)}>
                                {line.returnedQty}
                              </td>
                              <td className={`${TD} text-[11px] whitespace-nowrap`}>
                                {lineState(line)}
                              </td>
                              <td className={TD}>
                                {line.source === 'inbound_shipment' ? (
                                  <>
                                    {line.inboundShipmentBox &&
                                      (isStationDevice() ? (
                                        <p className="text-[11px]">
                                          <Link
                                            to="/inbound/boxes"
                                            search={{
                                              shipmentId:
                                                line.inboundShipmentBox
                                                  .shipmentId,
                                              boxId:
                                                line.inboundShipmentBox.boxId,
                                            }}
                                            className="text-[#2563eb] underline"
                                          >
                                            {
                                              line.inboundShipmentBox
                                                .shipmentName
                                            }{' '}
                                            · 상자{' '}
                                            {line.inboundShipmentBox.boxLabel}
                                          </Link>
                                        </p>
                                      ) : (
                                        <p className="text-[11px]">
                                          {
                                            line.inboundShipmentBox
                                              .shipmentName
                                          }{' '}
                                          · 상자{' '}
                                          {line.inboundShipmentBox.boxLabel}
                                        </p>
                                      ))}
                                    {!isStationDevice() && (
                                      <p className={UNAVAILABLE}>
                                        스테이션에서 취소해요
                                      </p>
                                    )}
                                  </>
                                ) : line.canCancel && current ? (
                                  <Button
                                    aria-label={`${line.skuName} 입고 취소`}
                                    className="border border-[#e3c6c3] bg-white px-2.5 py-[7px] text-xs font-medium text-[#a33b33] hover:border-[#a1a1aa] hover:bg-white hover:brightness-100"
                                    disabled={!!selection || !supported}
                                    onClick={() =>
                                      setSelection({
                                        lineId: line.id,
                                        source: line.source,
                                        skuName: line.skuName,
                                        originLocationCode:
                                          line.originLocationCode,
                                        receivedAt: receipt.occurredAt,
                                      })
                                    }
                                  >
                                    입고 취소
                                  </Button>
                                ) : line.cancelBlockReason ? (
                                  <p className={UNAVAILABLE}>
                                    {reasons[line.cancelBlockReason] ??
                                      '취소 가능 상태 확인 필요'}
                                    {line.cancelBlockReason ===
                                      'PUTAWAY_EXISTS' && (
                                      <span className="mt-1 block text-[11px] whitespace-normal text-[#8b8b95]">
                                        수량이 틀렸다면 {PUTAWAY_FIX_BY_COUNT}
                                      </span>
                                    )}
                                  </p>
                                ) : null}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex gap-2">
            <Button
              className={OUTLINE_BUTTON}
              disabled={
                !!selection || query.isFetching || (shown?.offset ?? 0) === 0
              }
              onClick={() => setOffset(Math.max(0, (shown?.offset ?? 0) - 20))}
            >
              이전
            </Button>
            <Button
              className={OUTLINE_BUTTON}
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
          <p className="text-[11px] text-[#71717a]">
            적치한 상품은 입고 취소할 수 없습니다. 취소한 내역도 목록에 남습니다.
          </p>
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
        <div className="space-y-[22px]">
          <HistoryHeader />
          <WarehousePicker />
        </div>
      )}
    </WorkArea>
  );
}
