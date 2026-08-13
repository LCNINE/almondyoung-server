'use client';

import { useState } from 'react';
import { useMastersSummary } from '@/lib/services/products/queries';
import { useDataTable } from '@/hooks/use-data-table';
import { useProductsListTableColumns } from '@/hooks/table/columns/use-products-list-table-columns';
import { useProductsListTableFilters } from '@/hooks/table/filters/use-products-list-table-filters';
import { useProductsListTableQuery } from '@/hooks/table/query/use-products-list-table-query';
import { DataTable } from '@/components/data-table';
import { Button } from '@/components/ui/button';
import { BulkActionModal, type BulkActionType } from '../bulk-action-modal';

const PAGE_SIZE = 20;

export function BulkTable() {
  const [modalAction, setModalAction] = useState<BulkActionType | null>(null);

  // 훅은 URL 의 size 를 우선한다 — fetch 하는 수(limit)와 그리는 수(페이지네이션/스켈레톤)가
  // 갈리지 않도록 지역 상수 대신 훅이 정한 pageSize 를 그대로 쓴다.
  const { searchParams: query, pageSize } = useProductsListTableQuery({
    pageSize: PAGE_SIZE,
  });
  const { data, isLoading, isFetching } = useMastersSummary(query);
  const columns = useProductsListTableColumns({
    totalCount: data?.total ?? 0,
    pageIndex: (query.page ?? 1) - 1,
    pageSize,
  });
  const filters = useProductsListTableFilters();

  const { table } = useDataTable({
    data: data?.data ?? [],
    columns,
    count: data?.total,
    pageSize,
    getRowId: (row) => row.masterId,
    enableRowSelection: true,
  });

  const selectedIds = table
    .getSelectedRowModel()
    .rows.map((r) => r.original.masterId);

  function handleSuccess() {
    table.resetRowSelection();
  }

  return (
    <div>
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b bg-muted/50 p-3">
          <span className="text-sm text-muted-foreground">
            {selectedIds.length}개 선택됨
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setModalAction('status')}
          >
            상태 변경
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setModalAction('approvalStatus')}
          >
            승인 상태 변경
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setModalAction('price')}
          >
            가격 변경
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setModalAction('brand')}
          >
            브랜드 변경
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setModalAction('restore')}
          >
            복원
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => setModalAction('delete')}
          >
            삭제
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => table.resetRowSelection()}
          >
            선택 해제
          </Button>
        </div>
      )}

      <DataTable
        table={table}
        isLoading={isLoading}
        isFetching={isFetching}
        count={data?.total ?? 0}
        pageSize={pageSize}
        filters={filters}
        search
        noRecords={{ message: '상품 데이터가 없습니다.' }}
      />

      <BulkActionModal
        open={modalAction !== null}
        onOpenChange={(open) => !open && setModalAction(null)}
        action={modalAction}
        selectedIds={selectedIds}
        onSuccess={handleSuccess}
      />
    </div>
  );
}
