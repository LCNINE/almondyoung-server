'use client';

import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { DateCell } from '@/components/table/table-cells/common';
import type { HolderDto } from '@/lib/types/dto/inventory';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const columnHelper = createColumnHelper<HolderDto>();

type RowActions = {
  onEdit: (row: HolderDto) => void;
  onDelete: (row: HolderDto) => void;
};

export const useHoldersTableColumns = (actions: RowActions) => {
  return useMemo(
    () => [
      columnHelper.accessor('name', {
        header: '소유자명',
        cell: ({ getValue }) => <span className="font-medium">{getValue()}</span>,
      }),
      columnHelper.accessor('isOurAsset', {
        header: '자사 여부',
        cell: ({ getValue }) =>
          getValue() ? (
            <Badge variant="default">자사</Badge>
          ) : (
            <Badge variant="secondary">위탁</Badge>
          ),
      }),
      columnHelper.accessor('createdAt', {
        header: '등록일',
        cell: ({ getValue }) => <DateCell value={getValue()} />,
      }),
      columnHelper.display({
        id: 'actions',
        header: '관리',
        cell: ({ row }) => (
          <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
            <Button variant="outline" size="sm" onClick={() => actions.onEdit(row.original)}>
              수정
            </Button>
            <Button variant="outline" size="sm" onClick={() => actions.onDelete(row.original)}>
              삭제
            </Button>
          </div>
        ),
      }),
    ],
    [actions]
  );
};
