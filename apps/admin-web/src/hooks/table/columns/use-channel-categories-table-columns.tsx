'use client';

import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import type { ChannelCategoryDto } from '@/lib/types/dto/products';
import { DateCell } from '@/components/table/table-cells/common';

const columnHelper = createColumnHelper<ChannelCategoryDto>();

type RowActions = {
  onEdit: (row: ChannelCategoryDto) => void;
  onDelete: (row: ChannelCategoryDto) => void;
};

export const useChannelCategoriesTableColumns = (actions: RowActions) => {
  return useMemo(
    () => [
      columnHelper.accessor('name', {
        header: '분류명',
        cell: ({ getValue }) => <span className="font-medium text-sm">{getValue()}</span>,
      }),
      columnHelper.accessor('description', {
        header: '설명',
        cell: ({ getValue }) => <span className="text-sm">{getValue() ?? '-'}</span>,
      }),
      columnHelper.accessor('displayOrder', {
        header: '정렬 순서',
        cell: ({ getValue }) => getValue(),
      }),
      columnHelper.accessor('channelCount', {
        header: '연결 채널 수',
        cell: ({ getValue }) => getValue() ?? 0,
      }),
      columnHelper.accessor('createdAt', {
        header: '생성일시',
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
              variant="destructive"
              onClick={() => actions.onDelete(row.original)}
              disabled={(row.original.channelCount ?? 0) > 0}
              title={
                (row.original.channelCount ?? 0) > 0
                  ? '연결된 채널이 있어 삭제할 수 없습니다'
                  : undefined
              }
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
