'use client';

import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import type { MovementWorkLogDto } from '@/lib/types/dto/inventory';
import { DateCell } from '@/components/table/table-cells/common';

const columnHelper = createColumnHelper<MovementWorkLogDto>();

export const useMovementHistoryTableColumns = () => {
  return useMemo(
    () => [
      columnHelper.accessor('type', {
        header: '유형',
        cell: ({ getValue }) => <Badge variant="outline">{getValue()}</Badge>,
      }),
      columnHelper.accessor('skuId', {
        header: 'SKU',
        cell: ({ getValue }) => {
          const v = getValue();
          return v ? <span className="font-mono text-xs">{v.substring(0, 8)}…</span> : '-';
        },
      }),
      columnHelper.accessor('fromLocationId', {
        header: '출발 위치',
        cell: ({ getValue }) => {
          const v = getValue();
          return v ? <span className="font-mono text-xs">{v.substring(0, 8)}…</span> : '-';
        },
      }),
      columnHelper.accessor('toLocationId', {
        header: '도착 위치',
        cell: ({ getValue }) => {
          const v = getValue();
          return v ? <span className="font-mono text-xs">{v.substring(0, 8)}…</span> : '-';
        },
      }),
      columnHelper.accessor('quantity', {
        header: '수량',
        cell: ({ getValue }) => {
          const v = getValue();
          return v != null ? v.toLocaleString() : '-';
        },
      }),
      columnHelper.accessor('reason', {
        header: '사유',
        cell: ({ getValue }) => <span className="text-sm">{getValue() ?? '-'}</span>,
      }),
      columnHelper.accessor('timestamp', {
        header: '일시',
        cell: ({ getValue }) => <DateCell value={getValue()} />,
      }),
    ],
    []
  );
};
