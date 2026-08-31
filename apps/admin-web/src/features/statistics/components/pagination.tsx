'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils/ui';
import { formatCount } from '../shared';

/**
 * 통계 테이블 공용 페이지네이션 바 — profit 탭의 모양을 표준화한 것.
 *
 * 서버가 페이지를 자르는 표라면 `isPaging` 에 `isPageChanging(query)` 를 넘겨라.
 * 이 표들은 `placeholderData` 로 이전 페이지를 유지하는데, React Query 는 placeholder 가
 * 있으면 `isLoading` 을 false 로 준다 — 그래서 페이지를 넘겨도 스켈레톤이 안 뜨고 옛 행이
 * 그대로 보인다. 느린 엔드포인트에서는 "페이지네이션이 안 먹는다"로 읽힌다.
 *
 * `query.isFetching` 을 직접 넘기지 마라 — 같은 페이지를 다시 확인하는 재요청까지 걸려
 * 맞는 페이지를 보는 중에 버튼이 잠긴다. 판정은 `isPageChanging` 이 한다.
 *
 * 응답이 통째로 화면에 들어오는 표(GA4 처럼 1회 대량 조회 후 화면에서 자르는 경우)는
 * 페이지를 넘겨도 요청이 안 나가므로 `isPaging` 이 필요 없다.
 */
export function PaginationBar({
  totalItems,
  page,
  pageSize,
  onPageChange,
  unitLabel = '개',
  isPaging = false,
}: {
  totalItems: number | undefined;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  unitLabel?: string;
  isPaging?: boolean;
}) {
  const totalPages = totalItems != null ? Math.max(1, Math.ceil(totalItems / pageSize)) : 1;
  return (
    <div className="mt-3 flex items-center justify-between text-xs text-gray-600">
      <span>
        전체 {formatCount(totalItems)}
        {unitLabel} · {page}/{totalPages} 페이지
        {isPaging ? <span className="ml-2 text-gray-400">불러오는 중…</span> : null}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={isPaging || page <= 1}
          onClick={() => onPageChange(Math.max(1, page - 1))}
          className="rounded border border-gray-200 px-2.5 py-1 disabled:opacity-40"
        >
          이전
        </button>
        <button
          type="button"
          disabled={isPaging || page >= totalPages}
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          className="rounded border border-gray-200 px-2.5 py-1 disabled:opacity-40"
        >
          다음
        </button>
      </div>
    </div>
  );
}

/**
 * 아직 옛 페이지가 남아 있는 동안 표를 흐리게 해서 "지금 보이는 건 요청한 페이지가 아니다"를
 * 드러낸다. 표시가 없으면 페이지 표시만 2/N 으로 바뀌고 행은 그대로라 페이지네이션이
 * 안 먹는 것으로 읽힌다. `PaginationBar` 와 짝으로 쓴다.
 */
export function PagingRows({ isPaging, children }: { isPaging: boolean; children: ReactNode }) {
  return (
    <div
      className={cn('transition-opacity', isPaging && 'pointer-events-none opacity-40')}
      aria-busy={isPaging}
    >
      {children}
    </div>
  );
}
