import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import type { RefundDto } from '@/lib/types/dto/wallet';
import { IdCell, DateCell } from '@/components/table/table-cells/common';
import { StatusBadgeCell, AmountCell } from '@/components/table/table-cells/wallet';
import Link from 'next/link';
import { RefundKindCell } from '@/features/payments/components/refund-table/kind-cell';
import { RefundConfirmCell } from '@/features/payments/components/refund-table/confirm-cell';
import { refundExecutionLabel, refundFailureLabel } from '@/lib/api/domains/wallet/refund-execution';

const columnHelper = createColumnHelper<RefundDto>();

export const useRefundTableColumns = () => {
  return useMemo(
    () => [
      columnHelper.accessor('id', {
        header: '환불 ID',
        cell: ({ getValue }) => <IdCell value={getValue()} />,
      }),
      columnHelper.accessor('intentId', {
        header: '결제 ID',
        cell: ({ getValue }) => {
          const id = getValue();
          return (
            <Link href={`/payments/${id}`} className="text-blue-600 hover:underline">
              <IdCell value={id} />
            </Link>
          );
        },
      }),
      columnHelper.accessor('amount', {
        header: '환불 금액',
        cell: ({ getValue, row }) => (
          <AmountCell value={getValue()} currency={row.original.currency} />
        ),
      }),
      columnHelper.accessor('status', {
        header: '상태',
        cell: ({ getValue }) => <StatusBadgeCell value={getValue()} type="refund" />,
      }),
      columnHelper.accessor('execution', {
        header: '방식',
        cell: ({ getValue }) => <span className="text-sm">{refundExecutionLabel(getValue())}</span>,
      }),
      columnHelper.display({
        id: 'kind',
        header: '종류',
        cell: ({ row }) => <RefundKindCell refund={row.original} />,
      }),
      columnHelper.accessor('reasonCode', {
        header: '사유 코드',
        cell: ({ getValue }) => <span className="text-sm">{getValue() ?? '-'}</span>,
      }),
      columnHelper.display({
        id: 'failure',
        header: '실패 사유',
        cell: ({ row }) => <span className="text-sm">{refundFailureLabel(row.original)}</span>,
      }),
      columnHelper.accessor('createdAt', {
        header: '생성일',
        cell: ({ getValue }) => <DateCell value={getValue()} />,
      }),
      columnHelper.display({
        id: 'actions',
        header: '',
        cell: ({ row }) => (row.original.manualConfirmable ? <RefundConfirmCell refund={row.original} /> : null),
      }),
    ],
    [],
  );
};
