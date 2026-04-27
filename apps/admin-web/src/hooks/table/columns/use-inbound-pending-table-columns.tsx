'use client';

import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { DateCell } from '@/components/table/table-cells/common';
import type { InboundPendingDto } from '@/lib/types/dto/inventory';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const columnHelper = createColumnHelper<InboundPendingDto>();

const PLAN_TYPE_LABELS: Record<string, string> = {
  source: '발송창고',
  destination: '수령창고',
};

type RowActions = {
  onDetail: (row: InboundPendingDto) => void;
};

export const useInboundPendingTableColumns = (actions: RowActions) => {
  return useMemo(
    () => [
      columnHelper.accessor('purchaseOrder', {
        header: '공급처',
        cell: ({ getValue }) => {
          const po = getValue();
          return po.supplier ? (
            <span className="text-sm">{po.supplier.name}</span>
          ) : (
            <span className="text-xs text-muted-foreground/40">—</span>
          );
        },
      }),
      columnHelper.accessor('planType', {
        header: '계획 유형',
        cell: ({ getValue }) => (
          <Badge variant="outline">{PLAN_TYPE_LABELS[getValue()] ?? getValue()}</Badge>
        ),
      }),
      columnHelper.accessor('purchaseOrder', {
        id: 'poType',
        header: '발주 유형',
        cell: ({ getValue }) => (
          <Badge variant="secondary">
            {getValue().type === 'domestic' ? '국내' : '해외'}
          </Badge>
        ),
      }),
      columnHelper.accessor('totalPendingQuantity', {
        header: '미입고 수량',
        cell: ({ getValue }) => <span className="text-sm font-medium">{getValue().toLocaleString()}</span>,
      }),
      columnHelper.accessor('totalQuantity', {
        header: '총 예정 수량',
        cell: ({ getValue }) => <span className="text-sm">{getValue().toLocaleString()}</span>,
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
      columnHelper.accessor('isLinkedPlan', {
        header: '이중 입고',
        cell: ({ getValue, row }) => {
          if (!getValue()) return <span className="text-xs text-muted-foreground/40">—</span>;
          return (
            <Badge variant="outline" className="text-xs">
              {row.original.sourcePlanStatus ?? '진행중'}
            </Badge>
          );
        },
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
