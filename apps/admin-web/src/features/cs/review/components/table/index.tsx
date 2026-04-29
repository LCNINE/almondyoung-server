'use client';

import { useMemo } from 'react';
import { useReviews } from '@/lib/services/review';
import { useMastersByIds } from '@/lib/services/products/queries';
import { useAdminUsersByIds } from '@/lib/services/users/queries';
import { useDataTable } from '@/hooks/use-data-table';
import {
  useReviewTableColumns,
  type ReviewProductSummary,
  type ReviewAuthorSummary,
} from '@/hooks/table/columns/use-review-table-columns';
import { useReviewTableFilters } from '@/hooks/table/filters/use-review-table-filters';
import { useReviewTableQuery } from '@/hooks/table/query/use-review-table-query';
import { DataTable } from '@/components/data-table';

const PAGE_SIZE = 20;

export function ReviewTable() {
  const { searchParams: query } = useReviewTableQuery({ pageSize: PAGE_SIZE });
  const { data, isLoading, isFetching } = useReviews(query);

  const reviews = data?.data ?? [];

  const productIds = useMemo(
    () =>
      Array.from(
        new Set(reviews.map((r) => r.productId).filter(Boolean) as string[])
      ),
    [reviews]
  );

  const userIds = useMemo(
    () =>
      Array.from(
        new Set(
          reviews
            .filter((r) => !r.legacy_author_name && !!r.userId)
            .map((r) => r.userId!) as string[]
        )
      ),
    [reviews]
  );

  const { data: products } = useMastersByIds(productIds);
  const { data: users } = useAdminUsersByIds(userIds);

  const productMap = useMemo(() => {
    const m = new Map<string, ReviewProductSummary>();
    (products?.data ?? []).forEach((p) => {
      m.set(p.masterId, {
        masterId: p.masterId,
        name: p.name,
        thumbnail: p.thumbnail,
      });
    });
    return m;
  }, [products]);

  const userMap = useMemo(() => {
    const m = new Map<string, ReviewAuthorSummary>();
    (users?.data ?? []).forEach((u) => {
      m.set(u.id, { id: u.id, username: u.username, nickname: u.nickname });
    });
    return m;
  }, [users]);

  const columns = useReviewTableColumns({ productMap, userMap });
  const filters = useReviewTableFilters();

  const { table } = useDataTable({
    data: reviews,
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
        { key: 'latest', label: '최신순' },
        { key: 'oldest', label: '오래된순' },
        { key: 'rating_high', label: '별점 높은순' },
        { key: 'rating_low', label: '별점 낮은순' },
      ]}
      orderByPresetOnly
      search
      navigateTo={(row) => `/cs/reviews/${row.original.id}`}
      noRecords={{ message: '리뷰 데이터가 없습니다.' }}
    />
  );
}
