import { isActionablePutaway } from './types';
import { usualShelfNotice } from './RememberUsualToggle';
import { useWorkCapabilities } from '../../core/operations/useWorkCapabilities';
import { useWorkRuntime } from '../../core/operations/OperationContext';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useWarehouse } from '../../app/warehouse-context';
import { errorMessage } from '../../core/data/errorMessage';
import { Button } from '../../core/design/Button';
import { PutawayScanResults } from './PutawayScanResults';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { useScanner } from '../../core/hardware/scan/useScanner';
import { useSkuByBarcode } from '../inventory/useSkuByBarcode';
import { WarehousePicker } from '../warehouse/WarehousePicker';
import { PutawaySheet, type LocationRef } from './PutawaySheet';
import { usePutawayPending, type PutawayDays } from './queries';
import type { PutawayPendingItem, PutawayTarget } from './types';
import {
  CancelReceiptDialog,
  type CancelReceiptTarget,
} from './CancelReceiptDialog';
import { useReturnGoods } from './returnGoods';
import { SaveToast, useSaveToast } from './SaveToast';
import { useWaitingOrders } from './waitingOrders';
import { ReadyShipmentsSection } from './ReadyShipmentsSection';
import { WaitingOrdersFailed, WaitingOrdersNote } from './WaitingOrdersNote';
import {
  ReturnPutawaySheet,
  type ReturnPutawayTarget,
} from './ReturnPutawaySheet';
import { Link } from '@tanstack/react-router';
import { ArrowRight, Check, Printer } from 'lucide-react';
import { cn } from '../../core/design/cn';
import { SkuThumbnail } from '../inventory/SkuInfoSheet';
import { useMyReturnBin } from '../returns/myReturnBin';

const DESCRIPTION = '입고된 상품과 출고 상자에서 꺼낸 상품을 선반에 놓으세요.';
const COLUMN = 'min-w-0 rounded-xl bg-[#f4f4f5] p-5 max-[900px]:p-3.5';
const COLUMN_HEAD =
  'mb-[18px] flex items-center gap-2 text-[15px] font-semibold text-[#27272a]';
const COUNT_BADGE =
  'rounded-[5px] bg-[#eff6ff] px-[7px] py-1 text-xs font-normal text-[#2563eb]';
const CARD =
  'mb-2.5 rounded-[9px] border border-[#e4e4e7] bg-white hover:border-[#2563eb]';
const THUMB = 'h-[53px] w-11 flex-none rounded-[7px] bg-[#f4f4f5]';
const PILL =
  'inline-flex shrink-0 items-center rounded-[5px] px-2 py-[5px] text-[11px] font-semibold whitespace-nowrap';
const OUTLINE_BUTTON =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-[#e4e4e7] bg-white px-4 py-[11px] text-sm font-semibold whitespace-nowrap text-[#27272a] hover:bg-[#eff6ff] hover:brightness-100';
const ERROR_BOX =
  'rounded-[10px] border border-[#efcbc4] bg-[#fff4f1] px-4 py-3 text-[13px] text-[#aa4037]';
const EMPTY_NOTE = 'px-2.5 py-[25px] text-xs text-[#71717a]';

interface CompletedPutaway {
  id: number;
  kind: 'inbound' | 'return';
  skuName: string;
  qty: number;
  locationCode: string;
  time: string;
}

function clockTime(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

const DAY_OPTIONS: Array<{ value: PutawayDays; label: string }> = [
  { value: 1, label: '최근 1일' },
  { value: 7, label: '최근 7일' },
  { value: 'all', label: '전체' },
];

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value;
  return `${part('year')}.${part('month')}.${part('day')} ${part('hour')}:${part('minute')}`;
}

export function PutawayQueueScreen({
  skuId,
  originLocationId,
}: { skuId?: string; originLocationId?: string } = {}) {
  const { warehouseId, isSet } = useWarehouse();
  const [days, setDays] = useState<PutawayDays>(1);
  const capabilities = useWorkCapabilities();
  const runtime = useWorkRuntime();
  const supported =
    !!runtime &&
    capabilities.isSuccess &&
    capabilities.data.inboundWorkflowConsistency === true;
  const filtered = !!skuId || !!originLocationId;
  // target 은 큐 데이터에서 매 렌더 다시 찾지 않는다 — 시트를 여는 순간의
  // 스냅샷이다. 백그라운드 refetch 로 pendingQty 가 바뀌어도 작업자가 입력
  // 중인 수량은 지워지지 않는다(서버가 실제 잔량을 재검증하므로 낡아도 안전).
  const [target, setTarget] = useState<PutawayTarget | null>(null);
  const [scan, setScan] = useState<{ id: number; skuIds: string[] } | null>(
    null
  );
  const scanId = useRef(0);
  const [notice, setNotice] = useState<string | null>(null);
  const toast = useSaveToast();
  const [lastDest, setLastDest] = useState<LocationRef | null>(null);
  const [returnTarget, setReturnTarget] = useState<ReturnPutawayTarget | null>(
    null
  );
  const [cancelTarget, setCancelTarget] = useState<CancelReceiptTarget | null>(
    null
  );
  const [completed, setCompleted] = useState<CompletedPutaway[]>([]);
  const completedId = useRef(0);

  function addCompleted(
    kind: CompletedPutaway['kind'],
    skuName: string,
    qty: number,
    locationCode: string
  ) {
    completedId.current += 1;
    const entry = {
      id: completedId.current,
      kind,
      skuName,
      qty,
      locationCode,
      time: clockTime(new Date()),
    };

    setCompleted((list) => [entry, ...list]);
  }
  // 반품 양품은 입고와 따로 반품 자리 재고 기준으로 본다 — 상품·원위치로 좁힌 화면에서는 숨긴다.
  const returnGoods = useReturnGoods(warehouseId, supported && !filtered);
  // 다시 읽기에 실패하면 남아 있는 옛 줄로 시트를 열지 않는다
  const returnItems =
    filtered || returnGoods.isError ? [] : (returnGoods.data?.items ?? []);

  const queue = usePutawayPending(
    warehouseId,
    filtered ? 'all' : days,
    skuId ? [skuId] : undefined,
    originLocationId
  );
  const byBarcode = useSkuByBarcode();
  const items = queue.data?.items ?? [];
  const waiting = useWaitingOrders(
    warehouseId,
    items.map((item) => item.skuId)
  );
  function select(item: PutawayPendingItem) {
    if (!supported || !isActionablePutaway(item)) return;
    setTarget({
      ...item,
      originLocationId: item.originLocationId,
      originLocationCode: item.originLocationCode,
    });
  }
  useEffect(() => {
    setTarget(null);
    setReturnTarget(null);
    setCancelTarget(null);
    setLastDest(null);
  }, [warehouseId, skuId, originLocationId]);
  useEffect(() => {
    setCompleted([]);
  }, [warehouseId]);

  const resetBarcode = byBarcode.reset;
  const clearScanFeedback = useCallback(() => {
    scanId.current += 1;
    setNotice(null);
    setScan(null);
    resetBarcode();
  }, [resetBarcode]);

  // Leaving this search context also cancels late barcode lookup results.
  useEffect(() => {
    clearScanFeedback();
  }, [days, warehouseId, skuId, originLocationId, clearScanFeedback]);
  useEffect(
    () => () => {
      scanId.current += 1;
    },
    []
  );

  useScanner((event) => {
    if (target || returnTarget || cancelTarget || !warehouseId || !supported)
      return;
    clearScanFeedback();
    const id = scanId.current;
    setNotice('상품을 확인하고 있어요.');
    byBarcode.mutate(event.code, {
      onSuccess: (skus) => {
        if (id !== scanId.current) return;
        if (!skus.length) {
          setNotice('등록되지 않은 바코드예요.');
          return;
        }
        setNotice(null);
        setScan({ id, skuIds: skus.map((sku) => sku.id) });
      },
      onError: () => {
        if (id === scanId.current) setNotice(null);
      },
    });
  });

  const binQuery = useMyReturnBin(warehouseId);
  const binItems = binQuery.data?.items ?? [];
  const binQty = binItems.reduce((sum, item) => sum + item.qty, 0);
  const returnGoodsQty = returnItems.reduce(
    (sum, item) => sum + item.quantity,
    0
  );

  if (!isSet) {
    return (
      <div className="space-y-5">
        <ScreenHeader title="적치·이동" backTo="/" description={DESCRIPTION} />
        <div className="space-y-3 rounded-xl border border-[#e4e4e7] bg-white p-5">
          <p className="text-[13px] text-[#71717a]">창고를 먼저 선택해 주세요.</p>
          <WarehousePicker />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ScreenHeader
        title="적치·이동"
        backTo="/"
        description={DESCRIPTION}
        right={
          <Link to="/putaway/location-labels" className={OUTLINE_BUTTON}>
            <Printer className="h-4 w-4" aria-hidden />
            로케이션 라벨
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {!filtered && (
          <div
            role="group"
            aria-label="입고 기간"
            className="flex gap-0.5 rounded-lg bg-[#ededee] p-1"
          >
            {DAY_OPTIONS.map((o) => (
              <button
                key={String(o.value)}
                type="button"
                aria-pressed={days === o.value}
                className={cn(
                  'rounded-[5px] px-3.5 py-[7px] text-[13px] whitespace-nowrap text-[#71717a]',
                  days === o.value &&
                    'bg-white font-semibold text-[#27272a] shadow-[0_1px_3px_#0000000c]'
                )}
                onClick={() => setDays(o.value)}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
        {filtered && (
          <p className="text-[13px] text-[#27272a]">
            선택한 상품과 원위치의 전체 기간 입고예요.
          </p>
        )}
        <p className="text-[13px] text-[#71717a]">
          상품 바코드를 스캔하거나 목록에서 고르세요.
        </p>
      </div>
      {!supported && (
        <p role="alert" className={ERROR_BOX}>
          앱과 서버 업데이트를 확인한 뒤 다시 시도해 주세요.
        </p>
      )}

      <SaveToast toast={toast.toast} />
      {notice ? (
        <p role="status" className="text-[13px] text-[#9a681c]">
          {notice}
        </p>
      ) : null}
      {byBarcode.isError ? (
        <p role="alert" className="text-[13px] text-[#aa4037]">
          {errorMessage(byBarcode.error, 'barcode')}
        </p>
      ) : null}

      <div className="grid grid-cols-1 items-stretch gap-5 max-[900px]:gap-3 min-[901px]:grid-cols-3">
        <section aria-label="입고 기본존" className={COLUMN}>
          <h3 className={COLUMN_HEAD}>
            입고 기본존{' '}
            {queue.isSuccess ? (
              <span className={COUNT_BADGE}>
                {`${items.length}${queue.data?.truncated ? '+' : ''}`}
              </span>
            ) : null}
          </h3>
          {queue.isError ? (
            <p role="alert" className="mb-2.5 text-[13px] text-[#aa4037]">
              {errorMessage(queue.error, 'putaway')}
            </p>
          ) : null}
          {queue.isLoading ? (
            <p className={EMPTY_NOTE}>불러오는 중…</p>
          ) : null}
          {queue.isSuccess && !queue.isFetching && items.length === 0 ? (
            <p className={EMPTY_NOTE}>
              {returnItems.length > 0
                ? '입고 적치 대기는 없어요.'
                : '적치할 항목이 없어요.'}
              {days === 'all' ? '' : ' 기간 필터를 넓혀 보세요.'}
            </p>
          ) : null}
          <WaitingOrdersFailed failed={waiting.failed} />
          {items.length > 0 && (
            <ul>
              {items.map((item) => (
                <li key={item.lineId} className={cn(CARD, 'overflow-hidden')}>
                  <button
                    type="button"
                    className="block w-full p-[18px] text-left disabled:opacity-60"
                    disabled={
                      !supported ||
                      !isActionablePutaway(item) ||
                      queue.isFetching
                    }
                    onClick={() => {
                      // 낡은 "적치 대기 없음" 안내와 미등록 바코드 오류 배너는 이 탭으로
                      // 더는 사실이 아니게 된다.
                      clearScanFeedback();
                      select(item);
                    }}
                  >
                    <span className="flex items-center gap-3">
                      <SkuThumbnail fileIds={item.imageFileIds} className={THUMB} />
                      <span className="min-w-0 flex-1">
                        <strong
                          id={`putaway-${item.lineId}`}
                          className="block truncate text-sm font-semibold text-[#27272a]"
                        >
                          {item.skuName}
                        </strong>
                        <small className="mt-1 block text-xs text-[#71717a]">
                          잔여 {item.pendingQty}개
                        </small>
                        <WaitingOrdersNote waiting={waiting.of(item.skuId)} />
                        {!item.canPutaway && (
                          <span className="mt-1 block text-xs text-[#9a681c]">
                            입고내역과 원위치를 확인해 주세요.
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="mt-[15px] flex items-center justify-between gap-2 text-xs text-[#71717a]">
                      <span className="min-w-0">
                        {item.usualLocationCode ? (
                          <span className="block truncate">
                            자주 놓는 위치{' '}
                            <strong className="font-semibold text-[#27272a]">
                              {item.usualLocationCode}
                            </strong>
                          </span>
                        ) : null}
                        <span className="block truncate">
                          {item.originLocationCode ?? '원위치 확인 필요'} ·{' '}
                          {formatTime(item.receivedAt)}
                        </span>
                      </span>
                      <ArrowRight
                        className="h-4 w-4 shrink-0 text-[#2563eb]"
                        aria-hidden
                      />
                    </span>
                  </button>
                  <div className="flex justify-end border-t border-[#e4e4e7] px-3 py-1">
                    <button
                      type="button"
                      aria-describedby={`putaway-${item.lineId}`}
                      className="px-2 py-1 text-xs text-[#71717a] underline disabled:opacity-50"
                      disabled={!supported || queue.isFetching}
                      onClick={() => {
                        clearScanFeedback();
                        setCancelTarget(item);
                      }}
                    >
                      잘못 입고 · 취소
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {queue.hasNextPage && !queue.isFetchNextPageError ? (
            <Button
              className={cn('w-full', OUTLINE_BUTTON)}
              onClick={() => void queue.fetchNextPage()}
              disabled={queue.isFetching}
            >
              {queue.isFetchingNextPage ? '불러오는 중…' : '더 보기'}
            </Button>
          ) : null}
          {queue.isError ? (
            <Button
              className={cn('w-full', OUTLINE_BUTTON)}
              onClick={() =>
                void (queue.isFetchNextPageError
                  ? queue.fetchNextPage()
                  : queue.refetch())
              }
              disabled={queue.isFetching}
            >
              다시 확인
            </Button>
          ) : null}
          {queue.data?.truncated && !queue.hasNextPage ? (
            <p className="mt-2.5 text-xs text-[#9a681c]">
              나머지 적치 대기를 확인하려면 관리자에게 앱과 서버 업데이트를
              요청해 주세요.
            </p>
          ) : null}
        </section>

        <section aria-label="선반 복귀 대기" className={COLUMN}>
          <h3 className={COLUMN_HEAD}>
            선반 복귀 대기{' '}
            {binQuery.isSuccess ? (
              <span className={COUNT_BADGE}>{binQty}</span>
            ) : null}
          </h3>
          {binItems.map((item) => (
            <Link
              key={`${item.skuId}|${item.sourceLocationId}`}
              to="/returns/putaway"
              aria-label={`${item.skuName} ${item.qty}개 선반 복귀`}
              className={cn(CARD, 'block p-[18px]')}
            >
              <small className="block text-xs text-[#71717a]">
                출고 상자에서 꺼낸 상품
              </small>
              <strong className="mt-2.5 mb-[5px] block text-sm font-semibold text-[#27272a]">
                {item.skuName} · {item.qty}개
              </strong>
              <span className="mt-[15px] flex items-center justify-between text-xs text-[#71717a]">
                <span>
                  복귀 선반{' '}
                  <strong className="font-semibold text-[#27272a]">
                    {item.locationCode}
                  </strong>
                </span>
                <ArrowRight className="h-4 w-4 text-[#2563eb]" aria-hidden />
              </span>
              <small className="mt-3 block text-xs text-[#71717a]">
                선반에 놓고 상품 바코드 스캔
              </small>
            </Link>
          ))}
          {binQuery.isLoading ? (
            <p className={EMPTY_NOTE}>불러오는 중…</p>
          ) : null}
          {binQuery.isError ? (
            <div role="alert" className="mb-2.5 text-[13px] text-[#aa4037]">
              선반 복귀 대기를 불러오지 못했어요.{' '}
              {errorMessage(binQuery.error, 'return-putaway')}{' '}
              <button
                type="button"
                className="underline"
                onClick={() => void binQuery.refetch()}
              >
                다시 불러오기
              </button>
            </div>
          ) : null}
          {binQuery.isSuccess && binItems.length === 0 ? (
            <p className="px-2.5 py-[25px] text-xs text-[#71717a]">
              복귀 대기 상품이 없습니다.
            </p>
          ) : null}
          <Link
            to="/returns/putaway"
            className="inline-flex w-full items-center gap-1.5 pt-0.5 pl-0.5 text-xs text-[#2563eb]"
          >
            선반 복귀 작업 열기 →
          </Link>
        </section>

        <section aria-label="적치 완료" className={COLUMN}>
          <h3 className={COLUMN_HEAD}>
            적치 완료{' '}
            <span className={COUNT_BADGE}>{completed.length}</span>
          </h3>
          <ul aria-label="적치 완료 상품">
            {completed.map((entry) => (
              <li key={entry.id} className={cn(CARD, 'p-[18px]')}>
                <small className="block text-xs text-[#71717a]">
                  {entry.kind === 'return' ? '반품 양품 적치' : '입고 적치'}
                </small>
                <strong className="mt-2.5 mb-[5px] block text-sm font-semibold text-[#27272a]">
                  {entry.skuName} · {entry.qty}개
                </strong>
                <span className="mt-[15px] flex items-center justify-between text-xs text-[#71717a]">
                  <span>
                    도착 위치 {entry.locationCode} · {entry.time}
                  </span>
                  <Check className="h-4 w-4 text-[#2563eb]" aria-hidden />
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {returnItems.length > 0 && returnGoods.data ? (
        <section aria-label="반품 양품" className={COLUMN}>
          <h3 className={COLUMN_HEAD}>
            반품 양품 — {returnGoods.data.locationCode}에서 선반으로{' '}
            <span className={COUNT_BADGE}>{returnGoodsQty}</span>
          </h3>
          <ul className="grid grid-cols-1 gap-x-5 min-[901px]:grid-cols-3">
            {returnItems.map((item) => (
              <li key={item.skuId}>
                <button
                  type="button"
                  className={cn(
                    CARD,
                    'block w-full p-[18px] text-left disabled:opacity-60'
                  )}
                  disabled={returnGoods.isFetching}
                  onClick={() => {
                    clearScanFeedback();
                    setReturnTarget({
                      ...item,
                      returnLocationId: returnGoods.data.locationId,
                      returnLocationCode: returnGoods.data.locationCode,
                    });
                  }}
                >
                  <span className="flex items-center justify-between gap-2">
                    <strong className="min-w-0 truncate text-sm font-semibold text-[#27272a]">
                      {item.skuName}
                    </strong>
                    <span className={cn(PILL, 'bg-[#eff6ff] text-[#2563eb]')}>
                      양품 {item.quantity}
                    </span>
                  </span>
                  <span className="mt-[15px] flex items-center justify-between text-xs text-[#71717a]">
                    <span>
                      {item.usualLocationCode
                        ? `평소 선반 ${item.usualLocationCode}`
                        : '평소 선반 없음'}
                    </span>
                    <ArrowRight
                      className="h-4 w-4 text-[#2563eb]"
                      aria-hidden
                    />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {returnGoods.isError && !filtered ? (
        <div role="alert" className={ERROR_BOX}>
          반품 양품을 불러오지 못했어요. {errorMessage(returnGoods.error)}{' '}
          <button
            type="button"
            className="underline"
            onClick={() => void returnGoods.refetch()}
          >
            다시 확인
          </button>
        </div>
      ) : null}

      {/* 화면 순서대로 넘긴다 — 100줄이 넘으면 화면 앞쪽 100줄만 본다 */}
      <ReadyShipmentsSection
        warehouseId={warehouseId}
        receiptLineIds={items.map((item) => item.lineId)}
      />

      {scan && warehouseId ? (
        <PutawayScanResults
          key={scan.id}
          warehouseId={warehouseId}
          skuIds={scan.skuIds}
          originLocationId={originLocationId}
          supported={supported}
          onSelect={(item) => {
            clearScanFeedback();
            select(item);
          }}
          onEmpty={() => {
            clearScanFeedback();
            setNotice('이 상품은 적치 대기가 없어요.');
          }}
          onClose={clearScanFeedback}
        />
      ) : null}

      {returnTarget && warehouseId ? (
        <ReturnPutawaySheet
          target={returnTarget}
          warehouseId={warehouseId}
          onCancel={() => {
            clearScanFeedback();
            setReturnTarget(null);
          }}
          onDone={(dest, quantity, usualShelfSet) => {
            clearScanFeedback();
            setReturnTarget(null);
            addCompleted('return', returnTarget.skuName, quantity, dest.code);
            setNotice(
              `${returnTarget.skuName} ${quantity}개를 ${dest.code}에 넣었어요.` +
                (usualShelfSet ? ` ${usualShelfNotice(dest.code)}` : '')
            );
          }}
        />
      ) : null}

      {cancelTarget && warehouseId ? (
        <CancelReceiptDialog
          target={cancelTarget}
          warehouseId={warehouseId}
          onClose={() => setCancelTarget(null)}
          onFinished={(outcome) => {
            clearScanFeedback();
            setCancelTarget(null);
            if (outcome.ok) toast.show({ kind: 'cancelled', detail: outcome.detail });
            else setNotice(outcome.notice);
            // 실패해도 다른 기기가 먼저 처리했을 수 있다
            void queue.refetch();
          }}
        />
      ) : null}

      {target ? (
        <PutawaySheet
          target={target}
          warehouseId={warehouseId}
          lastDest={lastDest}
          onCancel={() => {
            clearScanFeedback();
            setTarget(null);
          }}
          onDone={(dest, quantity, usualShelfSet) => {
            clearScanFeedback();
            setLastDest(dest);
            setTarget(null);
            addCompleted('inbound', target.skuName, quantity, dest.code);
            if (usualShelfSet) setNotice(usualShelfNotice(dest.code));
            // 잔량이 남으면 무효화된 큐가 줄어든 수량으로 다시 내려준다.
          }}
        />
      ) : null}
    </div>
  );
}
