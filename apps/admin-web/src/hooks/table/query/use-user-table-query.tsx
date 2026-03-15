import { AdminUsersQuery } from '@/lib/types/dto/user'
import { useQueryParams } from '../../use-query-params'

type UseUserTableQueryProps = {
  prefix?: string
  pageSize?: number
}

export const useUserTableQuery = ({
  prefix,
  pageSize = 20,
}: UseUserTableQueryProps) => {
  const queryObject = useQueryParams(
    ['page', 'q', 'username', 'email', 'roleName', 'sort', 'order'],
    prefix
  )

  const { page, q, username, email, roleName, sort, order } = queryObject

  const searchParams: AdminUsersQuery = {
    limit: pageSize,
    page: page ? Number(page) : 1,
    q,
    username,
    email,
    roleName,
    sort,
    order,
  }

  return { searchParams, raw: queryObject }
}
