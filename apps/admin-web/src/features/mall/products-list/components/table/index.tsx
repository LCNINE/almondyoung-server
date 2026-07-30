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
import { useProductsListTableQuery } from '@/hooks/table/query/use-products-list-table-query';
import { DataTable } from '@/components/data-table';
import { Button } from '@/components/ui/button';
import { Download, Trash2 } from 'lucide-react';
import {
  BulkActionModal,
  type BulkActionType,
} from '@/features/mall/bulk/components/bulk-action-modal';
import { BulkPolicyModal } from '@/features/mall/bulk/components/bulk-policy-modal';
import { SelectedProductsModal } from '../selected-products-modal';
import { ProductsListFilterBox } from '../filter-box';

const PAGE_SIZE = 20;

export function ProductsListTable() {
  const [modalAction, setModalAction] = useState<BulkActionType | null>(null);
  const [policyOpen, setPolicyOpen] = useState(false);

  const { searchParams: query } = useProductsListTableQuery({
    pageSize: PAGE_SIZE,
  });
  const { data, isLoading, isFetching } = useMastersSummary(query);
  const totalCount = data?.total ?? 0;
  const columns = useProductsListTableColumns({
    totalCount,
    pageIndex: (query.page ?? 1) - 1,
    pageSize: PAGE_SIZE,
  });

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
  const hasSelection = selectedIds.length > 0;

  // 스냅샷(selectedItems)은 effect 로 한 틱 늦게 갱신되므로, 표시용 목록은 현재
  // 선택 상태로 즉시 필터해 개별 해제가 프레임 지연 없이 반영되도록 한다.
  const selectedItemsList = Object.values(selectedItems).filter(
    (it) => rowSelection[it.masterId]
  );

  // 선택되는 순간 그 행은 반드시 현재 페이지에 로드돼 있으므로,
  // 이름/썸네일 스냅샷을 담아 교차 페이지/필터에서도 목록을 보여줄 수 있게 한다.
  useEffect(() => {
    const currentRows: SelectedProductSnapshot[] = (data?.data ?? []).map(
      (r) => ({
        masterId: r.masterId,
        name: r.name,
        thumbnail: r.thumbnail ?? null,
        hideMembershipPriceForNonMembers: r.hideMembershipPriceForNonMembers,
        isVisibleToMembersOnly: r.isVisibleToMembersOnly,
        isOverseas: r.isOverseas,
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
      <ProductsListFilterBox />

      <DataTable
        table={table}
        isLoading={isLoading}
        isFetching={isFetching}
        count={totalCount}
        pageSize={PAGE_SIZE}
        variant="grid"
        orderBy={[
          { key: 'createdAt', label: '등록일' },
          { key: 'name', label: '상품명' },
          { key: 'updatedAt', label: '수정일' },
        ]}
        toolbar={
          <div className="flex flex-wrap items-center gap-2 py-2">
            <span className="mr-1 text-sm font-medium">
              총 {totalCount.toLocaleString()}건
            </span>
            <SelectedProductsModal
              items={selectedItemsList}
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
            <Button size="sm" variant="outline" disabled={!hasSelection}>
              <Download className="w-3 h-3 mr-1" />
              엑셀 다운로드
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!hasSelection}
              onClick={() => setModalAction('status')}
            >
              선택 상품상태변경
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!hasSelection}
              onClick={() => setPolicyOpen(true)}
            >
              운영 노출 정책 변경
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={!hasSelection}
              onClick={() => setModalAction('delete')}
            >
              <Trash2 className="w-3 h-3 mr-1" />
              선택 삭제
            </Button>
          </div>
        }
        rowClassName={(row) =>
          row.original.status === 'draft' ? 'bg-[#fdf1f1]' : undefined
        }
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
        selectedItems={selectedItemsList}
        onSuccess={handleSuccess}
      />

      <BulkPolicyModal
        open={policyOpen}
        onOpenChange={setPolicyOpen}
        selectedIds={selectedIds}
        selectedItems={selectedItemsList}
        onSuccess={handleSuccess}
      />
    </div>
  );
}
