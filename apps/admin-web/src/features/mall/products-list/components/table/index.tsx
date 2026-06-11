'use client';

import { useState } from 'react';
import { useMastersSummary } from '@/lib/services/products/queries';
import { useDataTable } from '@/hooks/use-data-table';
import { useProductsListTableColumns } from '@/hooks/table/columns/use-products-list-table-columns';
import { useProductsListTableFilters } from '@/hooks/table/filters/use-products-list-table-filters';
import { useProductsListTableQuery } from '@/hooks/table/query/use-products-list-table-query';
import { DataTable } from '@/components/data-table';
import { Button } from '@/components/ui/button';
import { Download, Trash2 } from 'lucide-react';
import {
  BulkActionModal,
  type BulkActionType,
} from '@/features/mall/bulk/components/bulk-action-modal';

const PAGE_SIZE = 20;

export function ProductsListTable() {
  const [modalAction, setModalAction] = useState<BulkActionType | null>(null);

  const { searchParams: query } = useProductsListTableQuery({ pageSize: PAGE_SIZE });
  const { data, isLoading, isFetching } = useMastersSummary(query);
  const columns = useProductsListTableColumns();
  const filters = useProductsListTableFilters();

  const { table } = useDataTable({
    data: data?.data ?? [],
    columns,
    count: data?.total,
    pageSize: PAGE_SIZE,
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
        <div className="flex items-center gap-2 border-b bg-muted/50 p-3">
          <span className="text-sm text-muted-foreground">{selectedIds.length}개 선택됨</span>
          <Button size="sm" variant="outline">
            <Download className="mr-1 h-3 w-3" />
            엑셀 다운로드
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setModalAction('status')}
          >
            선택 상품상태변경
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setModalAction('delete')}
          >
            <Trash2 className="mr-1 h-3 w-3" />
            선택 삭제
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
        navigateTo={(row) =>
          // active 버전이 없는 상품은 GET /masters/:id 가 404 — versionId 로 직접 조회한다.
          row.original.status === 'active'
            ? `/mall/products-list/${row.original.masterId}`
            : `/mall/products-list/${row.original.masterId}?versionId=${row.original.versionId}`
        }
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
