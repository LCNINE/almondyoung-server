import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import type { PendingBankTransferDto } from '@/lib/types/dto/wallet';
import { IdCell, DateCell } from '@/components/table/table-cells/common';
import { AmountCell } from '@/components/table/table-cells/wallet';
import { PlaceholderCell } from '@/components/table/table-cells/common/placeholder-cell';

const columnHelper = createColumnHelper<PendingBankTransferDto>();

export const useBankTransferTableColumns = () => {
  return useMemo(
    () => [
      columnHelper.accessor('id', {
        header: '결제 ID',
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
      columnHelper.accessor('bankName', {
        header: '은행명',
        cell: ({ getValue }) => {
          const val = getValue();
          return val ? <span className="text-sm">{val}</span> : <PlaceholderCell />;
        },
      }),
      columnHelper.accessor('accountNumber', {
        header: '계좌번호',
        cell: ({ getValue }) => {
          const val = getValue();
          return val ? <span className="text-sm font-mono">{val}</span> : <PlaceholderCell />;
        },
      }),
      columnHelper.accessor('createdAt', {
        header: '생성일',
        cell: ({ getValue }) => <DateCell value={getValue()} />,
      }),
    ],
    [],
  );
};
