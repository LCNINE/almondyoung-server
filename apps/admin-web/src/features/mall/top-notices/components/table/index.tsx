'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { DataTable } from '@/components/data-table';
import { Button } from '@/components/ui/button';
import { useDataTable } from '@/hooks/use-data-table';
import { useTopNoticesTableColumns } from '@/hooks/table/columns/use-top-notices-table-columns';
import { useTopNoticesTableFilters } from '@/hooks/table/filters/use-top-notices-table-filters';
import { useTopNoticesTableQuery } from '@/hooks/table/query/use-top-notices-table-query';
import {
  useCreateTopNotice,
  useDeleteTopNotice,
  useTopNotices,
  useUpdateTopNotice,
} from '@/lib/services/products';
import { Can } from '@/components/auth/can';
import { usePermissionCheck } from '@/hooks/use-permission';
import type { TopNoticeDto } from '@/lib/types/dto/products';
import { TopNoticeDeleteDialog } from '../delete-dialog';
import { TopNoticeFormDialog } from '../form-dialog';

const PAGE_SIZE = 20;

export function TopNoticesTable() {
  const { searchParams } = useTopNoticesTableQuery();
  const { data, isLoading, isFetching } = useTopNotices(searchParams);
  const filters = useTopNoticesTableFilters();
  const updateMutation = useUpdateTopNotice();
  const deleteMutation = useDeleteTopNotice();
  const { canRun } = usePermissionCheck();

  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<TopNoticeDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TopNoticeDto | null>(null);

  const handleToggleActive = async (row: TopNoticeDto, isActive: boolean) => {
    try {
      await updateMutation.mutateAsync({ id: row.id, dto: { isActive } });
      toast.success(isActive ? '노출을 켰습니다.' : '노출을 껐습니다.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '변경에 실패했습니다.');
    }
  };

  const columns = useTopNoticesTableColumns({
    onEdit: (row) => {
      setEditTarget(row);
      setFormOpen(true);
    },
    onToggleActive: canRun(useUpdateTopNotice) ? handleToggleActive : undefined,
    onDelete: canRun(useDeleteTopNotice) ? setDeleteTarget : undefined,
  });

  const rows = data ?? [];

  const { table } = useDataTable({
    data: rows,
    columns,
    count: rows.length,
    pageSize: PAGE_SIZE,
    getRowId: (row) => row.id,
  });

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;

    try {
      await deleteMutation.mutateAsync(deleteTarget.id);
      toast.success('상단 공지 띠가 삭제되었습니다.');
      setDeleteTarget(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '삭제에 실패했습니다.');
    }
  };

  return (
    <>
      <div className="flex items-center gap-2 px-4 pt-4">
        <Can run={useCreateTopNotice}>
          <Button
            size="sm"
            onClick={() => {
              setEditTarget(null);
              setFormOpen(true);
            }}
          >
            띠 등록
          </Button>
        </Can>
      </div>

      <DataTable
        table={table}
        isLoading={isLoading}
        isFetching={isFetching}
        count={rows.length}
        pageSize={PAGE_SIZE}
        filters={filters}
        noRecords={{ message: '등록된 상단 공지 띠가 없습니다.' }}
      />

      <TopNoticeFormDialog open={formOpen} target={editTarget} onOpenChange={setFormOpen} />

      <TopNoticeDeleteDialog
        open={!!deleteTarget}
        target={deleteTarget}
        isLoading={deleteMutation.isPending}
        onConfirm={handleDeleteConfirm}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      />
    </>
  );
}
