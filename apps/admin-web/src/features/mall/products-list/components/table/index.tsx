'use client';

import { useMemo } from 'react';
import { useMasters } from '@/lib/services/products/queries';
import { useDataTable } from '@/hooks/use-data-table';
import { useProductsListTableColumns } from '@/hooks/table/columns/use-products-list-table-columns';
import { useProductsListTableFilters } from '@/hooks/table/filters/use-products-list-table-filters';
import { useProductsListTableQuery } from '@/hooks/table/query/use-products-list-table-query';
import { DataTable } from '@/components/data-table';
import { Button } from '@/components/ui/button';
import { Download, Trash2 } from 'lucide-react';

const PAGE_SIZE = 20;

export function ProductsListTable() {
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

  const selectedRows = table.getSelectedRowModel().rows;

  const pendingMatchingCount = useMemo(() => {
    return (data?.data ?? []).reduce((count, master) => {
      const variants = master.variants ?? [];
      const hasChannelProduct = master.channelProducts && master.channelProducts.length > 0;
      return count + (hasChannelProduct ? 0 : variants.length);
    }, 0);
  }, [data?.data]);

  return (
    <div>
      {pendingMatchingCount > 0 && (
        <div className="mx-4 mt-4 flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-3">
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500">
            <span className="text-xs text-white">!</span>
          </div>
          <span className="text-sm font-semibold text-red-700">
            매칭 대기 상품(옵션기준) {pendingMatchingCount}개
          </span>
        </div>
      )}

      {selectedRows.length > 0 && (
        <div className="flex items-center gap-2 border-b bg-muted/50 p-3">
          <span className="text-sm text-muted-foreground">{selectedRows.length}개 선택됨</span>
          <Button size="sm" variant="outline">
            <Download className="mr-1 h-3 w-3" />
            엑셀 다운로드
          </Button>
          <Button size="sm" variant="outline">
            선택 상품상태변경
          </Button>
          <Button size="sm" variant="outline">
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
        noRecords={{ message: '상품 데이터가 없습니다.' }}
      />
    </div>
  );
}
