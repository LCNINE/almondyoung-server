'use client';

import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { DateCell } from '@/components/table/table-cells/common';
import { Button } from '@/components/ui/button';
import type { SkuGroupResponseDto } from '@/lib/types/dto/inventory';

const columnHelper = createColumnHelper<SkuGroupResponseDto>();

type RowActions = {
  onEdit: (row: SkuGroupResponseDto) => void;
  onViewMembers: (row: SkuGroupResponseDto) => void;
  onDelete: (row: SkuGroupResponseDto) => void;
};

export const useSkuGroupsTableColumns = (actions: RowActions) => {
  return useMemo(
    () => [
      columnHelper.accessor('code', {
        header: '그룹 코드',
        cell: ({ getValue }) => (
          <span className="font-mono text-xs">{getValue()}</span>
        ),
      }),
      columnHelper.accessor('name', { header: '그룹명' }),
      columnHelper.accessor('description', {
        header: '설명',
        cell: ({ getValue }) => (
          <span className="text-xs text-muted-foreground">{getValue() ?? '—'}</span>
        ),
      }),
      columnHelper.accessor('memberCount', {
        header: 'SKU 수',
        cell: ({ getValue }) => (
          <span className="tabular-nums text-xs">{getValue().toLocaleString('ko-KR')}</span>
        ),
      }),
      columnHelper.accessor('updatedAt', {
        header: '수정일',
        cell: ({ getValue }) => <DateCell value={getValue()} />,
      }),
      columnHelper.display({
        id: 'actions',
        header: '액션',
        cell: ({ row }) => (
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => actions.onViewMembers(row.original)}
            >
              멤버
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => actions.onEdit(row.original)}
            >
              편집
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-destructive hover:text-destructive"
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
