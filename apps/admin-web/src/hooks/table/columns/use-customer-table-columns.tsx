import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { CustomerListItem } from '@/lib/types';
import { IdCell, DateCell, CopyableTextCell, PlaceholderCell } from '@/components/table/table-cells/common';
import { EmailVerifiedCell, RoleCell } from '@/components/table/table-cells/user';
import { formatPhoneNumber } from '@/lib/utils/phone';

const columnHelper = createColumnHelper<CustomerListItem>();

export const useCustomerTableColumns = () => {
  return useMemo(
    () => [
      columnHelper.accessor('id', {
        header: 'ID',
        cell: ({ getValue }) => <IdCell value={getValue()} />,
      }),
      columnHelper.accessor('loginId', {
        header: '로그인ID',
        cell: ({ getValue }) => <CopyableTextCell value={getValue()} />,
      }),
      columnHelper.accessor('username', { header: '이름' }),
      columnHelper.accessor('email', { header: '이메일' }),
      columnHelper.accessor('phoneNumber', {
        header: '휴대전화',
        cell: ({ getValue }) => {
          const value = formatPhoneNumber(getValue());
          return value ? <span>{value}</span> : <PlaceholderCell />;
        },
      }),
      columnHelper.accessor('roles', {
        header: '등급',
        enableSorting: false,
        cell: ({ getValue }) => <RoleCell roles={getValue()} />,
      }),
      columnHelper.accessor('lastActivityAt', {
        header: '최근 활동일',
        cell: ({ getValue }) => <DateCell value={getValue()} />,
      }),
      columnHelper.accessor('createdAt', {
        header: '가입일',
        cell: ({ getValue }) => <DateCell value={getValue()} />,
      }),
    ],
    []
  );
};
