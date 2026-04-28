'use client';

import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { DateCell } from '@/components/table/table-cells/common';
import type { PurchaseOrderDto } from '@/lib/types/dto/inventory';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const columnHelper = createColumnHelper<PurchaseOrderDto>();

const STATUS_LABELS: Record<string, string> = {
  created: '생성됨',
  confirmed: '확정됨',
  received: '입고완료',
};

const AUDIT_STATUS_LABELS: Record<string, string> = {
  draft: '초안',
  pending_audit: '심사중',
  approved: '승인됨',
};

const AUDIT_STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'outline'> = {
  draft: 'outline',
  pending_audit: 'secondary',
  approved: 'default',
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
      columnHelper.accessor('auditStatus', {
        header: '심사 상태',
        cell: ({ getValue }) => {
          const val = getValue();
          return (
            <Badge variant={AUDIT_STATUS_VARIANTS[val] ?? 'outline'}>
              {AUDIT_STATUS_LABELS[val] ?? val}
            </Badge>
          );
        },
      }),
      columnHelper.accessor('lines', {
        header: '라인 수',
        cell: ({ getValue }) => (
          <span className="text-sm">{getValue()?.length ?? 0}</span>
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
