'use client';

import { useState } from 'react';
import { useMasters } from '@/lib/services/products';
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

  const { searchParams: query } = useProductsListTableQuery({ pageSize: PAGE_SIZE });
  const { data, isLoading, isFetching } = useMasters(query);
  const columns = useProductsListTableColumns();
  const filters = useProductsListTableFilters();

  const { table } = useDataTable({
    data: data?.data ?? [],
    columns,
    count: data?.total,
    pageSize: PAGE_SIZE,
    getRowId: (row) => row.id,
    enableRowSelection: true,
  });

  const selectedIds = table
    .getSelectedRowModel()
    .rows.map((r) => r.original.id);

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
          <Button size="sm" variant="outline" onClick={() => setModalAction('status')}>
            상태 변경
          </Button>
          <Button size="sm" variant="outline" onClick={() => setModalAction('approvalStatus')}>
            승인 상태 변경
          </Button>
          <Button size="sm" variant="outline" onClick={() => setModalAction('price')}>
            가격 변경
          </Button>
          <Button size="sm" variant="outline" onClick={() => setModalAction('brand')}>
            브랜드 변경
          </Button>
          <Button size="sm" variant="outline" onClick={() => setModalAction('restore')}>
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
        pageSize={PAGE_SIZE}
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
