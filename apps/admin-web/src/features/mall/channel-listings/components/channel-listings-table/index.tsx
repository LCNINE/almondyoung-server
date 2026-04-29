'use client';

import { useState } from 'react';
import { DataTable } from '@/components/data-table';
import { useDataTable } from '@/hooks/use-data-table';
import { useChannelListingsTableColumns } from '@/hooks/table/columns/use-channel-listings-table-columns';
import { useChannelListingsByVariant } from '@/lib/services/products';
import {
  useActivateChannelListing,
  useDeactivateChannelListing,
  useDeleteChannelListing,
} from '@/lib/services/products';
import type { ChannelListingWithChannelDto, ChannelListingDto } from '@/lib/types/dto/products';
import { toast } from 'sonner';
import { ChannelListingFormDialog } from '../channel-listing-form-dialog';

const PAGE_SIZE = 50;

type Props = {
  variantId: string;
};

export function ChannelListingsTable({ variantId }: Props) {
  const { data, isLoading, isFetching } = useChannelListingsByVariant(variantId);
  const activateMutation = useActivateChannelListing();
  const deactivateMutation = useDeactivateChannelListing();
  const deleteMutation = useDeleteChannelListing();

  const [editRow, setEditRow] = useState<ChannelListingDto | null>(null);

  const handleToggleActive = async (row: ChannelListingWithChannelDto) => {
    try {
      if (row.isActive) {
        await deactivateMutation.mutateAsync(row.id);
        toast.success('비활성화되었습니다.');
      } else {
        await activateMutation.mutateAsync(row.id);
        toast.success('활성화되었습니다.');
      }
    } catch {
      toast.error('상태 변경에 실패했습니다.');
    }
  };

  const handleDelete = async (row: ChannelListingWithChannelDto) => {
    if (!window.confirm('이 채널 리스팅을 삭제하시겠습니까?')) return;
    try {
      await deleteMutation.mutateAsync(row.id);
      toast.success('삭제되었습니다.');
    } catch {
      toast.error('삭제에 실패했습니다.');
    }
  };

  const columns = useChannelListingsTableColumns({
    onEdit: (row) => setEditRow(row as unknown as ChannelListingDto),
    onToggleActive: handleToggleActive,
    onDelete: handleDelete,
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

  return (
    <>
      <DataTable
        table={table}
        isLoading={isLoading}
        isFetching={isFetching}
        count={total}
        pageSize={PAGE_SIZE}
        noRecords={{ message: '등록된 채널 리스팅이 없습니다.' }}
      />

      <ChannelListingFormDialog
        variantId={variantId}
        listing={editRow}
        open={!!editRow}
        onOpenChange={(open) => {
          if (!open) setEditRow(null);
        }}
      />
    </>
  );
}
