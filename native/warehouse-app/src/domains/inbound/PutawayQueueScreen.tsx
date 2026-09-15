import { isActionablePutaway } from './types';
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

const DAY_OPTIONS: Array<{ value: PutawayDays; label: string }> = [
  { value: 1, label: '최근 1일' },
  { value: 7, label: '최근 7일' },
  { value: 'all', label: '전체' },
];

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
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
  const [lastDest, setLastDest] = useState<LocationRef | null>(null);

  const queue = usePutawayPending(
    warehouseId,
    filtered ? 'all' : days,
    skuId ? [skuId] : undefined,
    originLocationId
  );
  const byBarcode = useSkuByBarcode();
  const items = queue.data?.items ?? [];
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
    setLastDest(null);
  }, [warehouseId, skuId, originLocationId]);

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
    if (target || !warehouseId || !supported) return;
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

  if (!isSet) {
    return (
      <div className="space-y-4">
        <ScreenHeader title="적치" backTo="/" />
        <div className="space-y-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4">
          <p className="text-sm text-gray-600">창고를 먼저 선택해 주세요.</p>
          <WarehousePicker />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 로딩 중엔 아직 진짜 건수를 모른다 — "0건"으로 보이면 다 봤다는 오해를 준다. */}
      <ScreenHeader
        title="적치"
        backTo="/"
        right={
          queue.isSuccess
            ? `${items.length}${queue.data?.truncated ? '건+' : '건'}`
            : undefined
        }
      />

      {!filtered && (
        <div className="flex gap-2">
          {DAY_OPTIONS.map((o) => (
            <button
              key={String(o.value)}
              type="button"
              aria-pressed={days === o.value}
              className={
                days === o.value
                  ? 'rounded-md border border-blue-500 bg-blue-50 px-3 py-1.5 text-sm text-blue-700'
                  : 'rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700'
              }
              onClick={() => setDays(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
      {filtered && <p>선택한 상품과 원위치의 전체 기간 입고예요.</p>}
      {!supported && (
        <p role="alert">앱과 서버 업데이트를 확인한 뒤 다시 시도해 주세요.</p>
      )}
      <p className="text-sm text-gray-500">
        상품 바코드를 스캔하거나 목록에서 고르세요.
      </p>

      {notice ? (
        <p role="status" className="text-sm text-amber-700">
          {notice}
        </p>
      ) : null}
      {byBarcode.isError ? (
        <p role="alert" className="text-sm text-red-600">
          {errorMessage(byBarcode.error, 'barcode')}
        </p>
      ) : null}

      {queue.isError ? (
        <p role="alert" className="text-sm text-red-600">
          {errorMessage(queue.error, 'putaway')}
        </p>
      ) : null}
      {queue.isLoading ? (
        <p className="text-sm text-gray-500">불러오는 중…</p>
      ) : null}
      {queue.isSuccess && !queue.isFetching && items.length === 0 ? (
        <p className="text-sm text-gray-500">
          적치할 항목이 없어요.
          {days === 'all' ? '' : ' 기간 필터를 넓혀 보세요.'}
        </p>
      ) : null}
      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.lineId}>
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 text-left active:bg-gray-50"
                disabled={
                  !supported || !isActionablePutaway(item) || queue.isFetching
                }
                onClick={() => {
                  // 낡은 "적치 대기 없음" 안내와 미등록 바코드 오류 배너는 이 탭으로
                  // 더는 사실이 아니게 된다.
                  clearScanFeedback();
                  select(item);
                }}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-gray-800">
                    {item.skuName}
                  </span>
                  <span className="block text-xs text-gray-500">
                    {item.originLocationCode ?? '원위치 확인 필요'} ·{' '}
                    {formatTime(item.receivedAt)}
                  </span>
                  {!item.canPutaway && (
                    <span className="block text-sm text-amber-700">
                      입고내역과 원위치를 확인해 주세요.
                    </span>
                  )}
                </span>
                <span className="shrink-0 rounded-full bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
                  잔여 {item.pendingQty}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {queue.hasNextPage && !queue.isFetchNextPageError ? (
        <Button
          onClick={() => void queue.fetchNextPage()}
          disabled={queue.isFetching}
        >
          {queue.isFetchingNextPage ? '불러오는 중…' : '더 보기'}
        </Button>
      ) : null}
      {queue.isError ? (
        <Button
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
        <p className="text-xs text-amber-700">
          나머지 적치 대기를 확인하려면 관리자에게 앱과 서버 업데이트를 요청해
          주세요.
        </p>
      ) : null}

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

      {target ? (
        <PutawaySheet
          target={target}
          warehouseId={warehouseId}
          lastDest={lastDest}
          onCancel={() => {
            clearScanFeedback();
            setTarget(null);
          }}
          onDone={(dest) => {
            clearScanFeedback();
            setLastDest(dest);
            setTarget(null);
            // 잔량이 남으면 무효화된 큐가 줄어든 수량으로 다시 내려준다.
          }}
        />
      ) : null}
    </div>
  );
}
