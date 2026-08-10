'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { DataTable } from '@/components/data-table';
import { Button } from '@/components/ui/button';
import { useDataTable } from '@/hooks/use-data-table';
import { useSitePopupsTableColumns } from '@/hooks/table/columns/use-site-popups-table-columns';
import { useSitePopupsTableFilters } from '@/hooks/table/filters/use-site-popups-table-filters';
import { useSitePopupsTableQuery } from '@/hooks/table/query/use-site-popups-table-query';
import { useDeleteSitePopup, useSitePopups } from '@/lib/services/products';
import type { SitePopupDto } from '@/lib/types/dto/products';
import { PopupCreateDialog } from '../create-dialog';
import { PopupDeleteDialog } from '../delete-dialog';

const PAGE_SIZE = 20;

export function PopupsTable() {
  const router = useRouter();
  const { searchParams } = useSitePopupsTableQuery();
  const { data, isLoading, isFetching } = useSitePopups(searchParams);
  const filters = useSitePopupsTableFilters();
  const deleteMutation = useDeleteSitePopup();

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SitePopupDto | null>(null);

  const columns = useSitePopupsTableColumns({
    onDetail: (row) => router.push(`/mall/popups/${row.id}`),
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
      await deleteMutation.mutateAsync(deleteTarget.id);
      toast.success('팝업이 삭제되었습니다.');
      setDeleteTarget(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '삭제에 실패했습니다.');
    }
  };

  return (
    <>
      <div className="flex items-center gap-2 px-4 pt-4">
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          팝업 등록
        </Button>
      </div>

      <DataTable
        table={table}
        isLoading={isLoading}
        isFetching={isFetching}
        count={rows.length}
        pageSize={PAGE_SIZE}
        filters={filters}
        noRecords={{ message: '등록된 팝업이 없습니다.' }}
      />

      <PopupCreateDialog open={createOpen} onOpenChange={setCreateOpen} />

      <PopupDeleteDialog
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
