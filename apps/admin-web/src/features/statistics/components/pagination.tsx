'use client';

import { formatCount } from '../shared';

/**
 * 통계 테이블 공용 페이지네이션 바 — profit 탭의 모양을 표준화한 것.
 *
 * `isFetching` 을 반드시 넘겨라. 이 표들은 `placeholderData` 로 이전 페이지를 유지하는데,
 * React Query 는 placeholder 가 있으면 `isLoading` 을 false 로 준다 — 그래서 페이지를 넘겨도
 * 스켈레톤이 안 뜨고 옛 행이 그대로 보인다. 느린 엔드포인트에서는 "페이지네이션이 안 먹는다"로
 * 읽힌다. 넘기지 않으면 표시가 없을 뿐 동작은 같다.
 */
export function PaginationBar({
  totalItems,
  page,
  pageSize,
  onPageChange,
  unitLabel = '개',
  isFetching = false,
}: {
  totalItems: number | undefined;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  unitLabel?: string;
  isFetching?: boolean;
}) {
  const totalPages = totalItems != null ? Math.max(1, Math.ceil(totalItems / pageSize)) : 1;
  return (
    <div className="mt-3 flex items-center justify-between text-xs text-gray-600">
      <span>
        전체 {formatCount(totalItems)}
        {unitLabel} · {page}/{totalPages} 페이지
        {isFetching ? <span className="ml-2 text-gray-400">불러오는 중…</span> : null}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={isFetching || page <= 1}
          onClick={() => onPageChange(Math.max(1, page - 1))}
          className="rounded border border-gray-200 px-2.5 py-1 disabled:opacity-40"
        >
          이전
        </button>
        <button
          type="button"
          disabled={isFetching || page >= totalPages}
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          className="rounded border border-gray-200 px-2.5 py-1 disabled:opacity-40"
        >
          다음
        </button>
      </div>
    </div>
  );
}
