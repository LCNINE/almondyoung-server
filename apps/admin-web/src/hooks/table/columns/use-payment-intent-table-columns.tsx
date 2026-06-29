import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import type { PaymentIntentListItem } from '@/lib/types/dto/wallet';
import { IdCell, DateCell } from '@/components/table/table-cells/common';
import { StatusBadgeCell, AmountCell, PaymentMethodTypeCell } from '@/components/table/table-cells/wallet';
import type { UserInfo } from '@/hooks/use-user-names';

const columnHelper = createColumnHelper<PaymentIntentListItem>();

type UseColumnsOptions = {
  userMap?: Record<string, UserInfo>;
};

export const usePaymentIntentTableColumns = ({ userMap = {} }: UseColumnsOptions = {}) => {
  return useMemo(
    () => [
      columnHelper.accessor('id', {
        header: 'ID',
        cell: ({ getValue }) => <IdCell value={getValue()} />,
      }),
      columnHelper.accessor('userId', {
        header: '사용자',
        cell: ({ getValue }) => {
          const userId = getValue();
          const username = userId ? userMap[userId]?.username : undefined;
          return (
            <div className="flex flex-col gap-0.5">
              <span className="text-sm">
                {username || <span className="text-muted-foreground">-</span>}
              </span>
              <IdCell value={userId} />
            </div>
          );
        },
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
        cell: ({ getValue, row }) => <StatusBadgeCell value={row.original.displayStatus ?? getValue()} type="intent" />,
      }),
      columnHelper.accessor('createdAt', {
        header: '생성일시',
        cell: ({ getValue }) => <DateCell value={getValue()} withTime />,
      }),
    ],
    [userMap],
  );
};
