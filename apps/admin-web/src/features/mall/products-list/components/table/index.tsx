'use client';

import { useEffect, useState } from 'react';
import {
  selectedIdsFromRowSelection,
  reconcileSelectedSnapshots,
  type SelectedProductSnapshot,
} from './products-list-selection-model';
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
import { SelectedProductsPopover } from '../selected-products-popover';

const PAGE_SIZE = 20;

export function ProductsListTable() {
  const [modalAction, setModalAction] = useState<BulkActionType | null>(null);

  const { searchParams: query } = useProductsListTableQuery({
    pageSize: PAGE_SIZE,
  });
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

  const [selectedItems, setSelectedItems] = useState<
    Record<string, SelectedProductSnapshot>
  >({});

  const rowSelection = table.getState().rowSelection;
  const selectedIds = selectedIdsFromRowSelection(rowSelection);

  // 선택되는 순간 그 행은 반드시 현재 페이지에 로드돼 있으므로,
  // 이름/썸네일 스냅샷을 담아 교차 페이지/필터에서도 목록을 보여줄 수 있게 한다.
  useEffect(() => {
    const currentRows: SelectedProductSnapshot[] = (data?.data ?? []).map(
      (r) => ({
        masterId: r.masterId,
        name: r.name,
        thumbnail: r.thumbnail ?? null,
      })
    );
    setSelectedItems((prev) => {
      const { changed, next } = reconcileSelectedSnapshots(
        prev,
        rowSelection,
        currentRows
      );
      return changed ? next : prev;
    });
  }, [rowSelection, data]);

  function handleSuccess() {
    table.resetRowSelection();
    setSelectedItems({});
  }

  return (
    <div>
      {selectedIds.length > 0 && (
        <div className="fixed z-50 flex items-center gap-2 p-2 pl-4 -translate-x-1/2 border rounded-lg shadow-lg bottom-6 left-1/2 bg-background">
          <SelectedProductsPopover
            items={Object.values(selectedItems)}
            count={selectedIds.length}
            onRemove={(masterId) =>
              table.setRowSelection((prev) => {
                const next = { ...prev };
                delete next[masterId];
                return next;
              })
            }
            onClearAll={() => table.resetRowSelection()}
          />
          <Button size="sm" variant="outline">
            <Download className="w-3 h-3 mr-1" />
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
            <Trash2 className="w-3 h-3 mr-1" />
            선택 삭제
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
        orderBy={[
          { key: 'createdAt', label: '등록일' },
          { key: 'name', label: '상품명' },
          { key: 'updatedAt', label: '수정일' },
        ]}
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
        selectedItems={Object.values(selectedItems)}
        onSuccess={handleSuccess}
      />
    </div>
  );
}
