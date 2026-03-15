import { createColumnHelper } from '@tanstack/react-table'
import { useMemo } from 'react'
import { AdminUserDto } from '@/lib/types/dto/user'
import { IdCell, DateCell } from '@/components/table/table-cells/common'
import { EmailVerifiedCell } from '@/components/table/table-cells/user'

const columnHelper = createColumnHelper<AdminUserDto>()

export const useUserTableColumns = () => {
  return useMemo(
    () => [
      columnHelper.accessor('id', {
        header: 'ID',
        cell: ({ getValue }) => <IdCell value={getValue()} />,
      }),
      columnHelper.accessor('loginId', { header: '로그인ID' }),
      columnHelper.accessor('username', { header: '이름' }),
      columnHelper.accessor('email', { header: '이메일' }),
      columnHelper.accessor('isEmailVerified', {
        header: '이메일 인증',
        cell: ({ getValue }) => <EmailVerifiedCell value={getValue()} />,
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
  )
}
