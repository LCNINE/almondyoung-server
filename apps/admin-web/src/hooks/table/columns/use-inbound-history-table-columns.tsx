'use client';

import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { DateCell } from '@/components/table/table-cells/common';
import type { InboundReceiptDto } from '@/lib/types/dto/inventory';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const columnHelper = createColumnHelper<InboundReceiptDto>();

const METHOD_LABELS: Record<string, string> = {
  individual: '개별입고',
  simple: '간편입고',
  simple_fullscan: '전수조사',
  planned: '예정입고',
};

const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  posted: 'default',
  draft: 'outline',
  cancelled: 'destructive',
  voided: 'secondary',
};

const STATUS_LABELS: Record<string, string> = {
  posted: '확정',
  draft: '임시',
  cancelled: '취소됨',
  voided: '무효',
};

type RowActions = {
  onDetail: (row: InboundReceiptDto) => void;
};

export const useInboundHistoryTableColumns = (actions: RowActions) => {
  return useMemo(
    () => [
      columnHelper.accessor('id', {
        header: '입고번호',
        cell: ({ getValue }) => (
          <span className="font-mono text-xs">{getValue().substring(0, 8)}…</span>
        ),
      }),
      columnHelper.accessor('method', {
        header: '입고 방식',
        cell: ({ getValue }) => (
          <Badge variant="outline">{METHOD_LABELS[getValue()] ?? getValue()}</Badge>
        ),
      }),
      columnHelper.accessor('totalQuantity', {
        header: '입고 수량',
        cell: ({ getValue }) => (
          <span className="text-sm font-medium">{getValue().toLocaleString()}</span>
        ),
      }),
      columnHelper.accessor('status', {
        header: '상태',
        cell: ({ getValue }) => {
          const val = getValue();
          return (
            <Badge variant={STATUS_VARIANTS[val] ?? 'outline'}>
              {STATUS_LABELS[val] ?? val}
            </Badge>
          );
        },
      }),
      columnHelper.accessor('occurredAt', {
        header: '입고 일시',
        cell: ({ getValue }) => <DateCell value={getValue()} />,
      }),
      columnHelper.accessor('createdAt', {
        header: '등록일',
        cell: ({ getValue }) => <DateCell value={getValue()} />,
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
