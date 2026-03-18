import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import type { PaymentIntentListItem } from '@/lib/types/dto/wallet';
import { IdCell, DateCell } from '@/components/table/table-cells/common';
import { StatusBadgeCell, AmountCell, PaymentMethodTypeCell } from '@/components/table/table-cells/wallet';

const columnHelper = createColumnHelper<PaymentIntentListItem>();

export const usePaymentIntentTableColumns = () => {
  return useMemo(
    () => [
      columnHelper.accessor('id', {
        header: 'ID',
        cell: ({ getValue }) => <IdCell value={getValue()} />,
      }),
      columnHelper.accessor('userId', {
        header: '사용자 ID',
        cell: ({ getValue }) => <IdCell value={getValue()} />,
      }),
      columnHelper.accessor('payableAmount', {
        header: '결제 금액',
        cell: ({ getValue, row }) => (
          <AmountCell value={getValue()} currency={row.original.currency} />
        ),
      }),
      columnHelper.accessor('paymentMethodType', {
        header: '결제수단',
        cell: ({ getValue }) => <PaymentMethodTypeCell value={getValue()} />,
      }),
      columnHelper.accessor('status', {
        header: '상태',
        cell: ({ getValue }) => <StatusBadgeCell value={getValue()} type="intent" />,
      }),
      columnHelper.accessor('createdAt', {
        header: '생성일',
        cell: ({ getValue }) => <DateCell value={getValue()} />,
      }),
    ],
    [],
  );
};
