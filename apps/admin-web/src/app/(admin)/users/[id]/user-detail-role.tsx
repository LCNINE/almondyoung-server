'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Container } from '@/components/admin-ui-experimental/common/container'
import { Header } from '@/components/admin-ui-experimental/common/header'
import { Spinner } from '@/components/ui/spinner'
import { useUserRoles } from '@/lib/services/users'
import { useDataTable } from '@/hooks/use-data-table'
import { useUserRoleTableColumns } from '@/hooks/table/columns/use-user-role-table-columns'
import { DataTable } from '@/components/data-table'

const PAGE_SIZE = 5

function UserRoleTable({ userId }: { userId: string }) {
  const { data } = useUserRoles(userId)
  const searchParams = useSearchParams()

  const currentPage = Number(searchParams.get('roles_page') ?? '1')
  const pageIndex = currentPage - 1
  const pagedRoles = data.roles.slice(pageIndex * PAGE_SIZE, (pageIndex + 1) * PAGE_SIZE)

  const columns = useUserRoleTableColumns()

  const { table } = useDataTable({
    data: pagedRoles,
    columns,
    count: data.roles.length,
    pageSize: PAGE_SIZE,
    getRowId: (row) => row.roleId,
    prefix: 'roles',
  })

  return (
    <DataTable
      table={table}
      count={data.roles.length}
      pageSize={PAGE_SIZE}
      prefix="roles"
      noRecords={{ message: '할당된 역할이 없습니다.' }}
    />
  )
}

export function UserDetailRole({ userId }: { userId: string }) {
  return (
    <Container className="divide-y">
      <Header title="권한" />
      <Suspense fallback={<div className="flex justify-center p-4"><Spinner /></div>}>
        <UserRoleTable userId={userId} />
      </Suspense>
    </Container>
  )
}
