import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import type { AdminCustomer } from '@medusajs/types';
import { IdCell, DateCell } from '@/components/table/table-cells/common';

const columnHelper = createColumnHelper<AdminCustomer>();

export const useMedusaCustomerTableColumns = () => {
  return useMemo(
    () => [
      columnHelper.accessor('id', {
        header: 'ID',
        cell: ({ getValue }) => <IdCell value={getValue()} />,
      }),
      columnHelper.accessor('email', { header: '이메일' }),
      columnHelper.accessor(
        (row) => {
          const firstName = row.first_name ?? '';
          const lastName = row.last_name ?? '';
          return `${lastName}${firstName}`.trim() || '-';
        },
        { id: 'name', header: '이름' }
      ),
      columnHelper.accessor('phone', {
        header: '전화번호',
        cell: ({ getValue }) => getValue() ?? '-',
      }),
      columnHelper.accessor('has_account', {
        header: '계정 여부',
        cell: ({ getValue }) => (getValue() ? '있음' : '없음'),
      }),
      columnHelper.accessor('created_at', {
        header: '가입일',
        cell: ({ getValue }) => <DateCell value={getValue()} />,
      }),
    ],
    []
  );
};
