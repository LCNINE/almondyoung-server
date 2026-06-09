'use client';

import Link from 'next/link';
import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { ExternalLink } from 'lucide-react';
import { DateCell } from '@/components/table/table-cells/common';
import type { ReservationDto } from '@/lib/types/dto/inventory';

const columnHelper = createColumnHelper<ReservationDto>();

const STATUS_LABELS: Record<string, string> = {
  pending: '대기',
  confirmed: '확정',
  released: '해제',
  active: '활성',
};

const TARGET_TYPE_LABELS: Record<string, string> = {
  FULFILLMENT_ORDER: '풀필먼트 주문',
  MOVEMENT_TASK: '이동 작업',
};

type RowActions = {
  onRelease: (row: ReservationDto) => void;
};

export const useReservationsTableColumns = (actions: RowActions) => {
  return useMemo(
    () => [
      columnHelper.accessor('id', {
        header: '예약 ID',
        cell: ({ getValue }) => (
          <span className="font-mono text-xs text-muted-foreground">
            {getValue().slice(0, 8)}…
          </span>
        ),
      }),
      columnHelper.accessor('targetType', {
        header: '대상 타입',
        cell: ({ getValue }) => TARGET_TYPE_LABELS[getValue()] ?? getValue(),
      }),
      columnHelper.accessor('targetId', {
        header: '대상 ID',
        cell: ({ getValue, row }) => {
          const id = getValue();
          if (row.original.targetType === 'FULFILLMENT_ORDER') {
            return (
              <Link
                href={`/order/fulfillments/${id}`}
                className="flex items-center gap-1 font-mono text-xs hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {id.slice(0, 8)}…
                <ExternalLink className="h-3 w-3 text-muted-foreground" />
              </Link>
            );
          }
          return (
            <span className="font-mono text-xs text-muted-foreground">
              {id.slice(0, 8)}…
            </span>
          );
        },
      }),
      columnHelper.accessor('skuId', {
        header: 'SKU ID',
        cell: ({ getValue }) => (
          <span className="font-mono text-xs text-muted-foreground">
            {getValue().slice(0, 8)}…
          </span>
        ),
      }),
      columnHelper.accessor('quantity', {
        header: '수량',
        cell: ({ getValue }) => (
          <span className="tabular-nums">{getValue().toLocaleString('ko-KR')}</span>
        ),
      }),
      columnHelper.accessor('status', {
        header: '상태',
        cell: ({ getValue }) => STATUS_LABELS[getValue()] ?? getValue(),
      }),
      columnHelper.accessor('reason', {
        header: '사유',
        cell: ({ getValue }) => (
          <span className="text-sm text-muted-foreground">{getValue() ?? '-'}</span>
        ),
      }),
      columnHelper.accessor('timeoutAt', {
        header: '만료 시각',
        cell: ({ getValue }) => {
          const v = getValue();
          return v ? <DateCell value={v} /> : <span className="text-muted-foreground">-</span>;
        },
      }),
      columnHelper.accessor('createdAt', {
        header: '생성일시',
        cell: ({ getValue }) => <DateCell value={getValue()} />,
      }),
      columnHelper.display({
        id: 'actions',
        header: '액션',
        cell: ({ row }) => (
          <div onClick={(e) => e.stopPropagation()}>
            <button
              className="rounded px-2 py-1 text-xs hover:bg-muted"
              onClick={() => actions.onRelease(row.original)}
            >
              해제
            </button>
          </div>
        ),
      }),
    ],
    [actions]
  );
};
