'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePaymentIntentList } from '@/lib/services/wallet';
import { userApi } from '@/lib/api/domains/users';
import { useDataTable } from '@/hooks/use-data-table';
import { usePaymentIntentTableColumns } from '@/hooks/table/columns/use-payment-intent-table-columns';
import { usePaymentIntentTableFilters } from '@/hooks/table/filters/use-payment-intent-table-filters';
import { usePaymentIntentTableQuery } from '@/hooks/table/query/use-payment-intent-table-query';
import { useUserNames } from '@/hooks/use-user-names';
import { DataTable } from '@/components/data-table';

const PAGE_SIZE = 20;

export function PaymentIntentTable() {
  const { searchParams: query } = usePaymentIntentTableQuery({
    pageSize: PAGE_SIZE,
  });

  // 결제내역(wallet)엔 이름이 없으므로 검색어(q)를 user-service에서 userId로 해석해 필터링한다.
  const nameQuery = query.q?.trim() ?? '';
  const nameSearchActive = nameQuery.length > 0;
  const { data: userMatches, isFetching: isResolvingNames } = useQuery({
    // ponytail: 동명이인 1000명까지만 매칭(user-service limit 상한). 더 필요하면 페이지네이션.
    queryKey: ['payment-intent-name-search', nameQuery],
    queryFn: () => userApi.getAdminUsers({ q: nameQuery, limit: 1000 }),
    enabled: nameSearchActive,
    staleTime: 30 * 1000,
  });
  const matchedUserIds = nameSearchActive
    ? (userMatches?.data.map((u) => u.id) ?? [])
    : [];
  // 이름 검색 중 매칭 0건이면 전체 조회로 새지 않도록 빈 결과로 고정
  const hasZeroMatches =
    nameSearchActive && !isResolvingNames && matchedUserIds.length === 0;

  const listQuery = {
    ...query,
    q: undefined,
    userIds: nameSearchActive ? matchedUserIds.join(',') : undefined,
  };
  const { data, isLoading, isFetching } = usePaymentIntentList(listQuery, {
    enabled: !nameSearchActive || (!isResolvingNames && matchedUserIds.length > 0),
  });

  const rows = hasZeroMatches ? [] : (data?.data ?? []);
  const total = hasZeroMatches ? 0 : (data?.total ?? 0);
  const loading = isLoading || (nameSearchActive && isResolvingNames);

  const userIds = useMemo(
    () =>
      rows
        .map((p) => p.userId)
        .filter((id): id is string => Boolean(id)),
    [rows]
  );
  const userMap = useUserNames(userIds);
  const columns = usePaymentIntentTableColumns({ userMap });
  const filters = usePaymentIntentTableFilters();

  const { table } = useDataTable({
    data: rows,
    columns,
    count: total,
    pageSize: PAGE_SIZE,
    getRowId: (row) => row.id,
  });

  return (
    <DataTable
      table={table}
      isLoading={loading}
      isFetching={isFetching}
      count={total}
      pageSize={PAGE_SIZE}
      filters={filters}
      orderBy={[
        { key: 'createdAt', label: '생성일' },
        { key: 'payableAmount', label: '결제 금액' },
      ]}
      search
      navigateTo={(row) => `/payments/${row.original.id}`}
      noRecords={{ message: '결제 내역이 없습니다.' }}
    />
  );
}
