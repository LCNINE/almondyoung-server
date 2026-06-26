import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import type { PendingBankTransferDto } from '@/lib/types/dto/wallet';
import { IdCell, DateCell } from '@/components/table/table-cells/common';
import { PlaceholderCell } from '@/components/table/table-cells/common/placeholder-cell';
import { BankTransferConfirmCell } from '@/features/payments/components/bank-transfer-table/confirm-cell';
import { BankTransferDetailCell } from '@/features/payments/components/bank-transfer-table/detail-cell';
import type { UserInfo } from '@/hooks/use-user-names';

const columnHelper = createColumnHelper<PendingBankTransferDto>();

type UseColumnsOptions = {
  userMap?: Record<string, UserInfo>;
};

export const useBankTransferTableColumns = ({ userMap = {} }: UseColumnsOptions = {}) => {
  return useMemo(
    () => [
      columnHelper.accessor('id', {
        header: '결제 ID',
        cell: ({ getValue }) => <IdCell value={getValue()} />,
      }),
      columnHelper.accessor('userId', {
        header: '사용자',
        cell: ({ getValue }) => {
          const userId = getValue();
          if (!userId) return <PlaceholderCell />;
          const info = userMap[userId];
          const username = info?.username;
          const loginId = info?.loginId;
          return (
            <div className="flex flex-col gap-0.5">
              <span className="text-sm">
                {username || <span className="text-muted-foreground">-</span>}
              </span>
              {loginId ? (
                <span className="text-xs text-muted-foreground">
                  로그인 ID: {loginId}
                </span>
              ) : null}
              <IdCell value={userId} />
            </div>
          );
        },
      }),
      columnHelper.display({
        id: 'bankAccount',
        header: '입금 계좌',
        cell: ({ row }) => {
          const { bankName, accountNumber, accountHolder } = row.original;
          if (!bankName && !accountNumber) return <PlaceholderCell />;
          return (
            <div className="leading-tight">
              <div className="text-sm">
                <span className="font-medium">{bankName}</span>{' '}
                <span className="font-mono">{accountNumber}</span>
              </div>
              {accountHolder ? (
                <div className="text-xs text-muted-foreground">
                  예금주 {accountHolder}
                </div>
              ) : null}
            </div>
          );
        },
      }),
      columnHelper.accessor('payableAmount', {
        header: '결제 금액',
        cell: ({ getValue, row }) => (
          <div className="text-right">
            <span className="text-base font-bold tabular-nums">
              {getValue().toLocaleString('ko-KR')}
            </span>
            <span className="ml-1 text-xs text-muted-foreground">
              {row.original.currency}
            </span>
          </div>
        ),
      }),
      columnHelper.accessor('createdAt', {
        header: '생성일시',
        cell: ({ getValue }) => <DateCell value={getValue()} withTime />,
      }),
      columnHelper.display({
        id: 'actions',
        header: () => <div className="text-right">작업</div>,
        cell: ({ row }) => (
          <div className="flex justify-end gap-1.5">
            <BankTransferDetailCell
              id={row.original.id}
              userId={row.original.userId}
            />
            <BankTransferConfirmCell
              id={row.original.id}
              payableAmount={row.original.payableAmount}
              currency={row.original.currency}
            />
          </div>
        ),
      }),
    ],
    [userMap],
  );
};
