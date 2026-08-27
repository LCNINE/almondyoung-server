'use client';

import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { DateCell } from '@/components/table/table-cells/common';
import type { PurchaseOrderDto, PurchaseOrderStatus } from '@/lib/types/dto/inventory';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  formatLineProgress,
  summarizeLines,
} from '@/features/inventory/purchase-orders/line-execution-model';

const columnHelper = createColumnHelper<PurchaseOrderDto>();

// exhaustive Record 로 좁혀둔다 — 드로어(purchase-order-detail-drawer/index.tsx)의
// STATUS_LABELS 와 글자 그대로 동일해야 한다. 상태값이 늘 때 여기가 컴파일 에러로 잡힌다.
const STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  created: '생성됨',
  confirmed: '확정됨',
  received: '입고완료',
  cancelled: '취소됨',
};

type RowActions = {
  onDetail: (row: PurchaseOrderDto) => void;
};

export const usePurchaseOrdersTableColumns = (actions: RowActions) => {
  return useMemo(
    () => [
      columnHelper.accessor('id', {
        header: '발주번호',
        cell: ({ getValue }) => (
          <span className="font-mono text-xs">{getValue().substring(0, 8)}…</span>
        ),
      }),
      columnHelper.accessor('type', {
        header: '유형',
        cell: ({ getValue }) => (
          <Badge variant="outline">{getValue() === 'domestic' ? '국내' : '해외'}</Badge>
        ),
      }),
      columnHelper.accessor('supplier', {
        header: '공급처',
        cell: ({ getValue }) => {
          const supplier = getValue();
          if (!supplier) return <span className="text-xs text-muted-foreground/40">—</span>;
          return <span className="text-sm">{supplier.name}</span>;
        },
      }),
      columnHelper.accessor('status', {
        header: '운영 상태',
        cell: ({ getValue }) => (
          <Badge variant="secondary">{STATUS_LABELS[getValue()] ?? getValue()}</Badge>
        ),
      }),
      columnHelper.accessor('lines', {
        header: '라인 진행',
        cell: ({ getValue }) => (
          <span className="text-sm">{formatLineProgress(summarizeLines(getValue() ?? []))}</span>
        ),
      }),
      columnHelper.accessor('expectedArrival', {
        header: '입고 예정일',
        cell: ({ getValue }) => {
          const v = getValue();
          return v ? <DateCell value={v} /> : <span className="text-xs text-muted-foreground/40">—</span>;
        },
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => actions.onDetail(row.original)}
            >
              상세
            </Button>
          </div>
        ),
      }),
    ],
    [actions]
  );
};
