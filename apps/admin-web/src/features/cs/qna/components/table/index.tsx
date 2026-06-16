'use client';

import { useMemo } from 'react';
import { useQuestions } from '@/lib/services/qna';
import { useMastersByIds } from '@/lib/services/products/queries';
import { useAdminUsersByIds } from '@/lib/services/users/queries';
import { useDataTable } from '@/hooks/use-data-table';
import {
  useQnaTableColumns,
  type QnaAuthorSummary,
} from '@/hooks/table/columns/use-qna-table-columns';
import { useQnaTableFilters } from '@/hooks/table/filters/use-qna-table-filters';
import { useQnaTableQuery } from '@/hooks/table/query/use-qna-table-query';
import { DataTable } from '@/components/data-table';

const PAGE_SIZE = 20;

export function QnaTable() {
  const { searchParams: query } = useQnaTableQuery({ pageSize: PAGE_SIZE });
  const { data, isLoading, isFetching } = useQuestions(query);

  const questions = data?.data ?? [];

  const userIds = useMemo(
    () =>
      Array.from(
        new Set(questions.map((q) => q.userId).filter(Boolean) as string[])
      ),
    [questions]
  );

  // 상품 문의(productId 존재)만 모아 상품명을 배치 조회. 일반 문의는 productId 가 null.
  const productIds = useMemo(
    () =>
      Array.from(
        new Set(questions.map((q) => q.productId).filter(Boolean) as string[])
      ),
    [questions]
  );

  const { data: users } = useAdminUsersByIds(userIds);
  const { data: products } = useMastersByIds(productIds);

  const userMap = useMemo(() => {
    const m = new Map<string, QnaAuthorSummary>();
    (users?.data ?? []).forEach((u) => {
      m.set(u.id, { id: u.id, username: u.username, nickname: u.nickname });
    });
    return m;
  }, [users]);

  const productMap = useMemo(() => {
    const m = new Map<string, string>();
    (products?.data ?? []).forEach((p) => {
      m.set(p.masterId, p.name);
    });
    return m;
  }, [products]);

  const columns = useQnaTableColumns({ userMap, productMap });
  const filters = useQnaTableFilters();

  const { table } = useDataTable({
    data: questions,
    columns,
    count: data?.total,
    pageSize: PAGE_SIZE,
    getRowId: (row) => row.id,
  });

  return (
    <DataTable
      table={table}
      isLoading={isLoading}
      isFetching={isFetching}
      count={data?.total ?? 0}
      pageSize={PAGE_SIZE}
      filters={filters}
      orderBy={[
        { key: 'createdAt', label: '작성일' },
        { key: 'status', label: '상태' },
      ]}
      search
      navigateTo={(row) => `/cs/qna/${row.original.id}`}
      noRecords={{ message: 'Q&A 데이터가 없습니다.' }}
    />
  );
}
