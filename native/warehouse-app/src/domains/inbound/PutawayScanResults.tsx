import { useEffect } from 'react';
import { Button } from '../../core/design/Button';
import { usePutawayPending } from './queries';
import type { PutawayPendingItem } from './types';

/** A scan searches the warehouse across all dates, independently of the list. */
export function PutawayScanResults({
  warehouseId,
  skuIds,
  onSelect,
  onEmpty,
  onClose,
}: {
  warehouseId: string;
  skuIds: string[];
  onSelect: (item: PutawayPendingItem) => void;
  onEmpty: () => void;
  onClose: () => void;
}) {
  const query = usePutawayPending(warehouseId, 'all', skuIds);
  const items = query.data?.items ?? [];
  // Cached results from an earlier scan are not enough to conclude absence or
  // choose a receipt. Every newly mounted scan must finish its own refresh.
  const ready =
    query.isSuccess && query.isFetchedAfterMount && !query.isFetching;
  useEffect(() => {
    if (!ready || query.data?.truncated) return;
    const matches = query.data?.items ?? [];
    if (matches.length === 0) onEmpty();
    else if (matches.length === 1) onSelect(matches[0]);
  }, [ready, query.data, onEmpty, onSelect]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="적치 대상 선택"
    >
      <div className="max-h-[90vh] w-full max-w-sm space-y-3 overflow-y-auto rounded-xl bg-white p-5 shadow-lg">
        <h2 className="font-semibold text-gray-800">어느 건을 적치할까요?</h2>
        <p className="text-sm text-gray-500">
          이 창고의 전체 기간에서 찾은 적치 대기예요.
        </p>
        {query.isFetching && <p role="status">적치 대기를 확인하고 있어요.</p>}
        {query.isError && (
          <div className="space-y-2">
            <p role="alert">
              적치 대기를 확인하지 못했어요. 다시 확인해 주세요. 계속되면
              관리자에게 문의해 주세요.
            </p>
            <Button
              onClick={() =>
                void (query.isFetchNextPageError
                  ? query.fetchNextPage()
                  : query.refetch())
              }
              disabled={query.isFetching}
            >
              다시 확인
            </Button>
          </div>
        )}
        {query.isFetchedAfterMount && items.length > 0 && (
          <ul className="space-y-2">
            {items.map((item) => (
              <li key={item.lineId}>
                <button
                  type="button"
                  className="w-full space-y-1 rounded-lg border border-gray-200 p-3 text-left active:bg-gray-50"
                  onClick={() => onSelect(item)}
                >
                  <span className="block font-medium">{item.skuName}</span>
                  <span className="block text-sm text-gray-700">
                    {new Date(item.receivedAt).toLocaleString('ko-KR')} 입고 ·{' '}
                    {item.originLocationCode}
                  </span>
                  <span className="text-sm font-semibold">
                    잔여 {item.pendingQty}개
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {query.hasNextPage && !query.isFetchNextPageError && (
          <Button
            onClick={() => void query.fetchNextPage()}
            disabled={query.isFetching}
          >
            더 보기
          </Button>
        )}
        {query.data?.truncated && !query.hasNextPage && (
          <p role="alert">
            나머지 적치 대기를 확인하려면 관리자에게 앱과 서버 업데이트를 요청해
            주세요.
          </p>
        )}
        <Button
          className="w-full border border-gray-300 bg-white text-gray-700"
          onClick={onClose}
        >
          닫기
        </Button>
      </div>
    </div>
  );
}
