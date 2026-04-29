'use client';

import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ChannelListingWithChannelDto } from '@/lib/types/dto/products';
import { DateCell } from '@/components/table/table-cells/common';

const columnHelper = createColumnHelper<ChannelListingWithChannelDto>();

type RowActions = {
  onEdit: (row: ChannelListingWithChannelDto) => void;
  onToggleActive: (row: ChannelListingWithChannelDto) => void;
  onDelete: (row: ChannelListingWithChannelDto) => void;
};

export const useChannelListingsTableColumns = (actions: RowActions) => {
  return useMemo(
    () => [
      columnHelper.accessor('id', {
        header: 'ID',
        cell: ({ getValue }) => (
          <span className="font-mono text-xs">{getValue().substring(0, 8)}…</span>
        ),
      }),
      columnHelper.accessor('channel', {
        header: '채널',
        cell: ({ getValue }) => (
          <div>
            <p className="text-sm font-medium">{getValue().name}</p>
            <p className="text-xs text-muted-foreground">{getValue().site}</p>
          </div>
        ),
      }),
      columnHelper.accessor('channelItemId', {
        header: '채널 상품 ID',
        cell: ({ getValue }) => (
          <span className="font-mono text-sm">{getValue()}</span>
        ),
      }),
      columnHelper.accessor('channelItemName', {
        header: '채널 상품명',
        cell: ({ getValue }) => <span className="text-sm">{getValue() ?? '-'}</span>,
      }),
      columnHelper.accessor('channelPrice', {
        header: '채널 판매가',
        cell: ({ getValue }) => {
          const v = getValue();
          return v != null ? `${v.toLocaleString()}원` : '-';
        },
      }),
      columnHelper.accessor('isActive', {
        header: '상태',
        cell: ({ getValue }) => (
          <Badge variant={getValue() ? 'default' : 'secondary'}>
            {getValue() ? '활성' : '비활성'}
          </Badge>
        ),
      }),
      columnHelper.accessor('createdAt', {
        header: '등록일시',
        cell: ({ getValue }) => <DateCell value={getValue()} />,
      }),
      columnHelper.display({
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <div className="flex gap-1">
            <Button size="sm" variant="outline" onClick={() => actions.onEdit(row.original)}>
              편집
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => actions.onToggleActive(row.original)}
            >
              {row.original.isActive ? '비활성' : '활성'}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => actions.onDelete(row.original)}
            >
              삭제
            </Button>
          </div>
        ),
      }),
    ],
    [actions]
  );
};
