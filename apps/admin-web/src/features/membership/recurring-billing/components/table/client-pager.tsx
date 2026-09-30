'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { pageSlice } from '../../lib/client-page';

const PAGE_SIZE = 20;

/** 전체 목록을 받는 표(고착·재시도·약정 정리)에 20건씩 쪽을 붙인다. */
export function useClientPage<T>(rows: T[]) {
  const [page, setPage] = useState(1);
  const sliced = pageSlice(rows, page, PAGE_SIZE);
  const pager =
    rows.length > PAGE_SIZE ? (
      <div className="flex items-center justify-end gap-2 pt-2 text-sm">
        <span className="text-muted-foreground tabular-nums">
          {rows.length.toLocaleString('ko-KR')}건 · {sliced.page}/{sliced.pages}쪽
        </span>
        <Button variant="outline" size="sm" disabled={sliced.page <= 1} onClick={() => setPage(sliced.page - 1)}>
          이전
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={sliced.page >= sliced.pages}
          onClick={() => setPage(sliced.page + 1)}
        >
          다음
        </Button>
      </div>
    ) : null;
  return { pageRows: sliced.rows, pager };
}
