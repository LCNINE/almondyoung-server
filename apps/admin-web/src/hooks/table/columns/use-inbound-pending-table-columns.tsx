'use client';

import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { DateCell } from '@/components/table/table-cells/common';
import type { ExpectedArrivalDto } from '@/lib/types/dto/inventory';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const columnHelper = createColumnHelper<ExpectedArrivalDto>();

type RowActions = {
  onDetail: (row: ExpectedArrivalDto) => void;
};

export const useInboundPendingTableColumns = (actions: RowActions) => {
  return useMemo(
    () => [
      columnHelper.accessor('supplier', {
        header: '공급처',
        cell: ({ getValue }) => {
          const supplier = getValue();
          return supplier ? (
            <span className="text-sm">{supplier.name}</span>
          ) : (
            <span className="text-xs text-muted-foreground/40">—</span>
          );
        },
      }),
      columnHelper.accessor('type', {
        header: '발주 유형',
        cell: ({ getValue }) => (
          <Badge variant="secondary">
            {getValue() === 'domestic' ? '국내' : '해외'}
          </Badge>
        ),
      }),
      columnHelper.accessor('expectedDate', {
        header: '입고 예정일',
        cell: ({ getValue }) => {
          const v = getValue();
          return v ? (
            <DateCell value={v} />
          ) : (
            <span className="text-xs text-muted-foreground/40">미정</span>
          );
        },
      }),
      columnHelper.accessor('lines', {
        header: '품목 수',
        cell: ({ getValue }) => <span className="text-sm">{getValue().length.toLocaleString()}</span>,
      }),
      columnHelper.accessor('totalOutstandingQuantity', {
        header: '남은 수량',
        cell: ({ getValue }) => <span className="text-sm font-medium">{getValue().toLocaleString()}</span>,
      }),
      columnHelper.display({
        id: 'actions',
        header: '관리',
        cell: ({ row }) => (
          <div onClick={(e) => e.stopPropagation()}>
            <Button variant="outline" size="sm" onClick={() => actions.onDetail(row.original)}>
              상세
            </Button>
          </div>
        ),
      }),
    ],
    [actions]
  );
};
