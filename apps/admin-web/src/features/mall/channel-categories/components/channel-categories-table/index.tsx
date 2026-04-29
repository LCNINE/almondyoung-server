'use client';

import { useState } from 'react';
import { DataTable } from '@/components/data-table';
import { useDataTable } from '@/hooks/use-data-table';
import { useChannelCategoriesTableColumns } from '@/hooks/table/columns/use-channel-categories-table-columns';
import { useChannelCategories } from '@/lib/services/products';
import { useDeleteChannelCategory } from '@/lib/services/products';
import type { ChannelCategoryDto } from '@/lib/types/dto/products';
import { toast } from 'sonner';
import { ChannelCategoryFormDialog } from '../channel-category-form-dialog';

const PAGE_SIZE = 50;

export function ChannelCategoriesTable() {
  const { data, isLoading, isFetching } = useChannelCategories();
  const deleteMutation = useDeleteChannelCategory();

  const [editRow, setEditRow] = useState<ChannelCategoryDto | null>(null);

  const handleDelete = async (row: ChannelCategoryDto) => {
    if ((row.channelCount ?? 0) > 0) {
      toast.error('연결된 채널이 있어 삭제할 수 없습니다.');
      return;
    }
    if (!window.confirm(`"${row.name}" 분류를 삭제하시겠습니까?`)) return;
    try {
      await deleteMutation.mutateAsync(row.id);
      toast.success('삭제되었습니다.');
    } catch (e: any) {
      const status = e?.response?.status;
      if (status === 409) {
        toast.error('연결된 채널이 있어 삭제할 수 없습니다.');
      } else {
        toast.error('삭제에 실패했습니다.');
      }
    }
  };

  const columns = useChannelCategoriesTableColumns({
    onEdit: (row) => setEditRow(row),
    onDelete: handleDelete,
  });

  const rows = data?.data ?? [];

  const { table } = useDataTable({
    data: rows,
    columns,
    count: rows.length,
    pageSize: PAGE_SIZE,
    getRowId: (row) => row.id,
  });

  return (
    <>
      <DataTable
        table={table}
        isLoading={isLoading}
        isFetching={isFetching}
        count={rows.length}
        pageSize={PAGE_SIZE}
        noRecords={{ message: '등록된 채널 카테고리가 없습니다.' }}
      />

      <ChannelCategoryFormDialog
        category={editRow}
        open={!!editRow}
        onOpenChange={(open) => {
          if (!open) setEditRow(null);
        }}
      />
    </>
  );
}
