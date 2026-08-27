'use client';

import { formatCount } from '../shared';

/** 통계 테이블 공용 페이지네이션 바 — profit 탭의 모양을 표준화한 것 */
export function PaginationBar({
  totalItems,
  page,
  pageSize,
  onPageChange,
  unitLabel = '개',
}: {
  totalItems: number | undefined;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  unitLabel?: string;
}) {
  const totalPages = totalItems != null ? Math.max(1, Math.ceil(totalItems / pageSize)) : 1;
  return (
    <div className="mt-3 flex items-center justify-between text-xs text-gray-600">
      <span>
        전체 {formatCount(totalItems)}
        {unitLabel} · {page}/{totalPages} 페이지
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(Math.max(1, page - 1))}
          className="rounded border border-gray-200 px-2.5 py-1 disabled:opacity-40"
        >
          이전
        </button>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          className="rounded border border-gray-200 px-2.5 py-1 disabled:opacity-40"
        >
          다음
        </button>
      </div>
    </div>
  );
}
