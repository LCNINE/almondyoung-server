'use client';

import { useState } from 'react';
import { DataTable } from '@/components/data-table';
import { useDataTable } from '@/hooks/use-data-table';
import { useHoldersTableColumns } from '@/hooks/table/columns/use-holders-table-columns';
import { useHoldersTableFilters } from '@/hooks/table/filters/use-holders-table-filters';
import { useHoldersTableQuery } from '@/hooks/table/query/use-holders-table-query';
import { useHolders, useDeleteHolder } from '@/lib/services/inventory';
import type { HolderDto } from '@/lib/types/dto/inventory';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { HolderFormDialog } from '../holder-form-dialog';
import { toast } from 'sonner';

const PAGE_SIZE = 20;

export function HoldersTable() {
  const { searchParams: query } = useHoldersTableQuery({ pageSize: PAGE_SIZE });
  const { data, isLoading, isFetching } = useHolders(query);
  const filters = useHoldersTableFilters();
  const deleteMutation = useDeleteHolder();

  const [editRow, setEditRow] = useState<HolderDto | null>(null);
  const [deleteRow, setDeleteRow] = useState<HolderDto | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const columns = useHoldersTableColumns({
    onEdit: setEditRow,
    onDelete: setDeleteRow,
  });

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;

  const { table } = useDataTable({
    data: rows,
    columns,
    count: total,
    pageSize: PAGE_SIZE,
    getRowId: (row) => row.id,
  });

  const handleDelete = async () => {
    if (!deleteRow) return;
    try {
      await deleteMutation.mutateAsync(deleteRow.id);
      toast.success('소유자가 삭제되었습니다.');
      setDeleteRow(null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '삭제에 실패했습니다.';
      toast.error(msg);
      setDeleteRow(null);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2 px-4 pt-4">
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          소유자 등록
        </Button>
      </div>

      <DataTable
        table={table}
        isLoading={isLoading}
        isFetching={isFetching}
        count={total}
        pageSize={PAGE_SIZE}
        filters={filters}
        noRecords={{ message: '등록된 소유자가 없습니다.' }}
      />

      <HolderFormDialog open={createOpen} onOpenChange={setCreateOpen} />

      <HolderFormDialog
        open={!!editRow}
        onOpenChange={(open) => { if (!open) setEditRow(null); }}
        editRow={editRow}
      />

      <AlertDialog open={!!deleteRow} onOpenChange={(open) => { if (!open) setDeleteRow(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>소유자 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteRow?.name}</strong>을(를) 삭제하시겠습니까?
              SKU나 주문에 연결된 소유자는 삭제할 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? '삭제 중...' : '삭제'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
