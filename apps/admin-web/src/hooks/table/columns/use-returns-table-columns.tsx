'use client';

import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ReturnDto, ReturnStatus } from '@/lib/types/dto/inventory';
import { DateCell } from '@/components/table/table-cells/common';

const columnHelper = createColumnHelper<ReturnDto>();

const STATUS_LABELS: Record<ReturnStatus, string> = {
  requested: '회수 요청',
  received: '입고 완료',
  qc_passed: 'QC 통과',
  qc_failed: 'QC 실패',
  disposed: '처리 완료',
};

const STATUS_VARIANTS: Record<ReturnStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  requested: 'outline',
  received: 'secondary',
  qc_passed: 'default',
  qc_failed: 'destructive',
  disposed: 'secondary',
};

type RowActions = {
  onDetail: (row: ReturnDto) => void;
};

export const useReturnsTableColumns = (actions: RowActions) => {
  return useMemo(
    () => [
      columnHelper.accessor('id', {
        header: '회수 ID',
        cell: ({ getValue }) => (
          <span className="font-mono text-xs">{getValue().substring(0, 8)}…</span>
        ),
      }),
      columnHelper.accessor('status', {
        header: '상태',
        cell: ({ getValue }) => {
          const status = getValue() as ReturnStatus;
          return (
            <Badge variant={STATUS_VARIANTS[status] ?? 'outline'}>
              {STATUS_LABELS[status] ?? status}
            </Badge>
          );
        },
      }),
      columnHelper.accessor('orderId', {
        header: '주문 ID',
        cell: ({ getValue }) => {
          const v = getValue();
          return v ? <span className="font-mono text-xs">{v.substring(0, 8)}…</span> : '-';
        },
      }),
      columnHelper.accessor('warehouseId', {
        header: '창고',
        cell: ({ getValue }) => (
          <span className="font-mono text-xs">{getValue().substring(0, 8)}…</span>
        ),
      }),
      columnHelper.accessor('returnReason', {
        header: '반품 사유',
        cell: ({ getValue }) => <span className="text-sm">{getValue() ?? '-'}</span>,
      }),
      columnHelper.accessor('restockQuantity', {
        header: '재입고',
        cell: ({ getValue }) => getValue().toLocaleString(),
      }),
      columnHelper.accessor('disposeQuantity', {
        header: '폐기',
        cell: ({ getValue }) => getValue().toLocaleString(),
      }),
      columnHelper.accessor('createdAt', {
        header: '생성일시',
        cell: ({ getValue }) => <DateCell value={getValue()} />,
      }),
      columnHelper.display({
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <Button size="sm" variant="outline" onClick={() => actions.onDetail(row.original)}>
            상세
          </Button>
        ),
      }),
    ],
    [actions]
  );
};
