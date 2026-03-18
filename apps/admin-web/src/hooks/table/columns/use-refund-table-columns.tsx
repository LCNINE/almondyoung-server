import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import type { RefundDto } from '@/lib/types/dto/wallet';
import { IdCell, DateCell } from '@/components/table/table-cells/common';
import { StatusBadgeCell, AmountCell } from '@/components/table/table-cells/wallet';
import Link from 'next/link';

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
      columnHelper.accessor('reasonCode', {
        header: '사유 코드',
        cell: ({ getValue }) => <span className="text-sm">{getValue() ?? '-'}</span>,
      }),
      columnHelper.accessor('createdAt', {
        header: '생성일',
        cell: ({ getValue }) => <DateCell value={getValue()} />,
      }),
    ],
    [],
  );
};
