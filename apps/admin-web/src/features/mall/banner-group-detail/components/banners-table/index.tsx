'use client';

import { useState } from 'react';
import { DataTable } from '@/components/data-table';
import { useDataTable } from '@/hooks/use-data-table';
import { useBannersTableColumns } from '@/hooks/table/columns/use-banners-table-columns';
import { useBannersByGroup, useDeleteBanner } from '@/lib/services/products';
import type { BannerDto } from '@/lib/types/dto/products';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { BannerCreateDialog } from '../banner-create-dialog';
import { BannerEditDialog } from '../banner-edit-dialog';
import { BannerDeleteDialog } from '../banner-delete-dialog';

const PAGE_SIZE = 20;

type Props = {
  groupId: string;
};

export function BannersTable({ groupId }: Props) {
  const { data, isLoading, isFetching } = useBannersByGroup(groupId);
  const deleteMutation = useDeleteBanner();

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<BannerDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BannerDto | null>(null);

  const columns = useBannersTableColumns({
    onEdit: setEditTarget,
    onDelete: setDeleteTarget,
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
      await deleteMutation.mutateAsync({ id: deleteTarget.id, groupId });
      toast.success('배너가 삭제되었습니다.');
      setDeleteTarget(null);
    } catch {
      toast.error('삭제에 실패했습니다.');
    }
  };

  return (
    <>
      <div className="flex items-center gap-2 px-4 pt-4">
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          배너 추가
        </Button>
      </div>

      <DataTable
        table={table}
        isLoading={isLoading}
        isFetching={isFetching}
        count={rows.length}
        pageSize={PAGE_SIZE}
        noRecords={{ message: '등록된 배너가 없습니다.' }}
      />

      <BannerCreateDialog
        open={createOpen}
        groupId={groupId}
        onOpenChange={setCreateOpen}
      />

      <BannerEditDialog
        open={!!editTarget}
        banner={editTarget}
        groupId={groupId}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null);
        }}
      />

      <BannerDeleteDialog
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
