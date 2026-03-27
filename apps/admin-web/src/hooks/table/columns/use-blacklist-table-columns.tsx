import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { BlacklistResponse } from '@/lib/api/domains/blacklists';
import { IdCell, DateCell } from '@/components/table/table-cells/common';

const columnHelper = createColumnHelper<BlacklistResponse>();

export const useBlacklistTableColumns = () => {
  return useMemo(
    () => [
      columnHelper.accessor('id', {
        header: 'ID',
        cell: ({ getValue }) => <IdCell value={getValue()} />,
      }),
      columnHelper.accessor('user', {
        header: '사용자',
        cell: ({ getValue, row }) => {
          const user = getValue();
          if (!user) return <IdCell value={row.original.userId} />;
          return (
            <div className="flex flex-col">
              <span className="font-medium">{user.nickname || user.username}</span>
              <span className="text-xs text-gray-500">{user.email}</span>
            </div>
          );
        },
      }),
      columnHelper.accessor('reason', {
        header: '사유',
      }),
      columnHelper.accessor('internalNote', {
        header: '내부 메모',
        cell: ({ getValue }) => getValue() ?? '-',
      }),
      columnHelper.accessor('createdAt', {
        header: '등록일',
        cell: ({ getValue }) => <DateCell value={getValue()} />,
      }),
      columnHelper.accessor('deletedAt', {
        header: '해제일',
        cell: ({ getValue }) => {
          const value = getValue();
          return value ? <DateCell value={value} /> : '-';
        },
      }),
    ],
    []
  );
};
