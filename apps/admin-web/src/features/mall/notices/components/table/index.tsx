'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { DataTable } from '@/components/data-table';
import { useDataTable } from '@/hooks/use-data-table';
import { useNoticesTableColumns } from '@/hooks/table/columns/use-notices-table-columns';
import { useNoticesTableFilters } from '@/hooks/table/filters/use-notices-table-filters';
import { useNoticesTableQuery } from '@/hooks/table/query/use-notices-table-query';
import { useNotices, useDeleteNotice } from '@/lib/services/products';
import type { NoticeDto } from '@/lib/types/dto/products';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { NoticeCreateDialog } from '../create-dialog';
import { NoticeDeleteDialog } from '../delete-dialog';

const PAGE_SIZE = 20;

export function NoticesTable() {
  const router = useRouter();
  const { searchParams } = useNoticesTableQuery();
  const { data, isLoading, isFetching } = useNotices(searchParams);
  const filters = useNoticesTableFilters();
  const deleteMutation = useDeleteNotice();

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<NoticeDto | null>(null);

  const columns = useNoticesTableColumns({
    onDetail: (row) => router.push(`/mall/notices/${row.id}`),
    onDelete: setDeleteTarget,
  });

  const rows = data ?? [];
  const total = rows.length;

  const { table } = useDataTable({
    data: rows,
    columns,
    count: total,
    pageSize: PAGE_SIZE,
    getRowId: (row) => row.id,
  });

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync({ id: deleteTarget.id });
      toast.success('공지사항이 삭제되었습니다.');
      setDeleteTarget(null);
    } catch {
      toast.error('삭제에 실패했습니다.');
    }
  };

  return (
    <>
      <div className="flex items-center gap-2 px-4 pt-4">
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          공지 등록
        </Button>
      </div>

      <DataTable
        table={table}
        isLoading={isLoading}
        isFetching={isFetching}
        count={total}
        pageSize={PAGE_SIZE}
        filters={filters}
        noRecords={{ message: '등록된 공지사항이 없습니다.' }}
      />

      <NoticeCreateDialog open={createOpen} onOpenChange={setCreateOpen} />

      <NoticeDeleteDialog
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
