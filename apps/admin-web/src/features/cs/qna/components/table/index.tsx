'use client';

import { useMemo } from 'react';
import { useQuestions } from '@/lib/services/qna';
import { useMastersByIds } from '@/lib/services/products/queries';
import {
  useAdminUsers,
  useAdminUsersByIds,
} from '@/lib/services/users/queries';
import { useDataTable } from '@/hooks/use-data-table';
import { useQnaTableColumns } from '@/hooks/table/columns/use-qna-table-columns';
import type { QnaAuthorInfo } from '../qna-author';
import { useQnaTableFilters } from '@/hooks/table/filters/use-qna-table-filters';
import { useQnaTableQuery } from '@/hooks/table/query/use-qna-table-query';
import { DataTable } from '@/components/data-table';
import {
  QUESTION_STATUS_FILTERS,
  STATUS_LABELS,
  type QnaListQuery,
} from '@/lib/types/dto/qna';

const PAGE_SIZE = 20;
// ponytail: 검색어에 걸린 회원이 이보다 많으면 앞쪽만 작성자 검색에 쓴다
const AUTHOR_SEARCH_LIMIT = 100;

export function QnaTable() {
  const { searchParams } = useQnaTableQuery({ pageSize: PAGE_SIZE });

  // 검색어가 아이디·메일·전화번호일 수 있어 회원을 먼저 찾고, 그 ID 를 제목·내용 검색과 OR 로 묶는다
  const { data: matchedAuthors, isFetching: isSearchingAuthors } =
    useAdminUsers(
      { q: searchParams.q, limit: AUTHOR_SEARCH_LIMIT },
      { enabled: !!searchParams.q }
    );
  const query = {
    ...searchParams,
    authorIds: searchParams.q
      ? matchedAuthors?.data.map((u) => u.id).join(',')
      : undefined,
  };
  const { data, isLoading, isFetching } = useQuestions(query, {
    enabled: !searchParams.q || !isSearchingAuthors,
  });
  const statusCounts = useStatusCounts(query);

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
    const m = new Map<string, QnaAuthorInfo>();
    (users?.data ?? []).forEach((u) => {
      m.set(u.id, {
        username: u.username,
        loginId: u.loginId,
        email: u.email,
        phoneNumber: u.phoneNumber ?? null,
      });
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
      orderBy={[{ key: 'createdAt', label: '작성일' }]}
      search
      searchPlaceholder="제목·내용·고객 아이디·이메일·전화번호"
      tabs={{
        key: 'status',
        options: [
          { label: '전체', count: statusCounts.all },
          ...QUESTION_STATUS_FILTERS.map((status) => ({
            value: status,
            label: STATUS_LABELS[status],
            count: statusCounts[status],
          })),
        ],
      }}
      navigateTo={(row) => `/cs/qna/${row.original.id}`}
      noRecords={{ message: '조건에 맞는 문의가 없어요' }}
    />
  );
}

// 탭 옆 건수 — 지금 걸린 검색·필터는 그대로 두고 상태만 바꿔 total 만 받는다
function useStatusCounts(query: QnaListQuery) {
  const base = { ...query, status: undefined, page: 1, limit: 1 };
  const all = useQuestions(base);
  const active = useQuestions({ ...base, status: 'active' });
  const answered = useQuestions({ ...base, status: 'answered' });
  const deleted = useQuestions({ ...base, status: 'deleted' });
  return {
    all: all.data?.total,
    active: active.data?.total,
    answered: answered.data?.total,
    deleted: deleted.data?.total,
  };
}
