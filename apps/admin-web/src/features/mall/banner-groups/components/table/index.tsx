'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { DataTable } from '@/components/data-table';
import { useDataTable } from '@/hooks/use-data-table';
import { useBannerGroupsTableColumns } from '@/hooks/table/columns/use-banner-groups-table-columns';
import { useBannerGroupsTableFilters } from '@/hooks/table/filters/use-banner-groups-table-filters';
import { useBannerGroups, useDeleteBannerGroup } from '@/lib/services/products';
import type { BannerGroupDto } from '@/lib/types/dto/products';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { BannerGroupCreateDialog } from '../create-dialog';
import { BannerGroupDeleteDialog } from '../delete-dialog';

const PAGE_SIZE = 20;

export function BannerGroupsTable() {
  const router = useRouter();
  const { data, isLoading, isFetching } = useBannerGroups();
  const filters = useBannerGroupsTableFilters();
  const deleteMutation = useDeleteBannerGroup();

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BannerGroupDto | null>(null);

  const columns = useBannerGroupsTableColumns({
    onDetail: (row) => router.push(`/mall/banner-groups/${row.id}`),
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
      toast.success('배너 그룹이 삭제되었습니다. 소속 배너도 함께 삭제됩니다.');
      setDeleteTarget(null);
    } catch {
      toast.error('삭제에 실패했습니다.');
    }
  };

  return (
    <>
      <div className="flex items-center gap-2 px-4 pt-4">
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          그룹 생성
        </Button>
      </div>

      <DataTable
        table={table}
        isLoading={isLoading}
        isFetching={isFetching}
        count={total}
        pageSize={PAGE_SIZE}
        filters={filters}
        noRecords={{ message: '등록된 배너 그룹이 없습니다.' }}
      />

      <BannerGroupCreateDialog open={createOpen} onOpenChange={setCreateOpen} />

      <BannerGroupDeleteDialog
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
