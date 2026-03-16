import { createColumnHelper } from '@tanstack/react-table'
import { useMemo } from 'react'
import { RoleDto } from '@/lib/types/dto/user'

const columnHelper = createColumnHelper<RoleDto>()

export const useUserRoleTableColumns = () => {
  return useMemo(
    () => [
      columnHelper.accessor('name', { header: '역할명' }),
      columnHelper.accessor('description', {
        header: '설명',
        cell: ({ getValue }) => getValue() ?? '-',
      }),
    ],
    []
  )
}
