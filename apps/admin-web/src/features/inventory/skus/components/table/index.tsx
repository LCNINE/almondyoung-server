'use client';

import { useCallback, useState } from 'react';
import { DataTable } from '@/components/data-table';
import { useDataTable } from '@/hooks/use-data-table';
import { useSkusTableColumns } from '@/hooks/table/columns/use-skus-table-columns';
import { useSkusTableFilters } from '@/hooks/table/filters/use-skus-table-filters';
import { useSkusTableQuery } from '@/hooks/table/query/use-skus-table-query';
import { useSkus } from '@/lib/services/inventory';
import type { SkuResponseDto } from '@/lib/types/dto/inventory';
import { SkuFormDialog } from '../sku-form-dialog';
import { ChangeGroupDialog } from '../change-group-dialog';
import { DeleteSkuDialog } from '../delete-sku-dialog';
import { BulkAddToGroupDialog } from '../bulk-add-to-group-dialog';
import { Button } from '@/components/ui/button';

const PAGE_SIZE = 20;

export function SkusTable() {
  const { searchParams: query } = useSkusTableQuery({ pageSize: PAGE_SIZE });
  const { data, isLoading, isFetching } = useSkus(query);
  const filters = useSkusTableFilters();

  const [editRow, setEditRow] = useState<SkuResponseDto | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [changeGroupRow, setChangeGroupRow] = useState<SkuResponseDto | null>(null);
  const [deleteRow, setDeleteRow] = useState<SkuResponseDto | null>(null);
  const [bulkGroupOpen, setBulkGroupOpen] = useState(false);

  const handleEdit = useCallback((row: SkuResponseDto) => setEditRow(row), []);
  const handleChangeGroup = useCallback((row: SkuResponseDto) => setChangeGroupRow(row), []);
  const handleDelete = useCallback((row: SkuResponseDto) => setDeleteRow(row), []);

  const columns = useSkusTableColumns({
    onEdit: handleEdit,
    onChangeGroup: handleChangeGroup,
    onDelete: handleDelete,
  });

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;

  const { table } = useDataTable({
    data: rows,
    columns,
    count: total,
    pageSize: PAGE_SIZE,
    getRowId: (row) => row.id,
    enableRowSelection: true,
  });

  const selectedRows = table.getSelectedRowModel().rows;

  return (
    <div>
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            SKU 생성
          </Button>
        </div>
      </div>

      {selectedRows.length > 0 && (
        <div className="flex items-center gap-2 p-3 bg-muted/50 border-b">
          <span className="text-sm text-muted-foreground">
            {selectedRows.length}개 선택됨
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setBulkGroupOpen(true)}
          >
            그룹 일괄 추가
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
        count={total}
        pageSize={PAGE_SIZE}
        filters={filters}
        search
        noRecords={{ message: 'SKU 데이터가 없습니다.' }}
      />

      <SkuFormDialog
        open={createOpen || !!editRow}
        sku={editRow}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false);
            setEditRow(null);
          }
        }}
      />

      <ChangeGroupDialog
        sku={changeGroupRow}
        open={!!changeGroupRow}
        onOpenChange={(open) => { if (!open) setChangeGroupRow(null); }}
      />

      <DeleteSkuDialog
        sku={deleteRow}
        open={!!deleteRow}
        onOpenChange={(open) => { if (!open) setDeleteRow(null); }}
      />

      <BulkAddToGroupDialog
        skuIds={selectedRows.map((r) => r.original.id)}
        open={bulkGroupOpen}
        onOpenChange={(open) => {
          setBulkGroupOpen(open);
          if (!open) table.resetRowSelection();
        }}
      />
    </div>
  );
}
