'use client';

import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import type { ChannelDto } from '@/lib/types/dto/products';
import { SalesChannelMark, type SalesChannelType } from '@/components/common/sales-channel-mark';
import { Button } from '@/components/ui/button';

const columnHelper = createColumnHelper<ChannelDto>();

type UseSalesChannelTableColumnsProps = {
  onEdit: (channel: ChannelDto) => void;
  onDelete: (channel: ChannelDto) => void;
};

export function useSalesChannelTableColumns({
  onEdit,
  onDelete,
}: UseSalesChannelTableColumnsProps) {
  return useMemo(
    () => [
      columnHelper.accessor('type', {
        header: '채널 타입',
        cell: ({ getValue }) => (
          <SalesChannelMark channel={getValue() as SalesChannelType} size="sm" />
        ),
      }),
      columnHelper.accessor('name', {
        header: '판매처명',
      }),
      columnHelper.display({
        id: 'actions',
        header: '기능',
        cell: ({ row }) => (
          <div className="flex items-center justify-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-blue-600 hover:text-blue-700"
              onClick={() => onEdit(row.original)}
            >
              수정
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-red-600 hover:text-red-700"
              onClick={() => onDelete(row.original)}
            >
              삭제
            </Button>
          </div>
        ),
      }),
    ],
    [onEdit, onDelete]
  );
}
