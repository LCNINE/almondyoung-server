import { CustomerListQuery } from '@/lib/api/domains/customer'
import { useQueryParams } from '../../use-query-params'

type UseCustomerTableQueryProps = {
  prefix?: string
  pageSize?: number
}

export const useCustomerTableQuery = ({
  prefix,
  pageSize = 20,
}: UseCustomerTableQueryProps) => {
  const queryObject = useQueryParams(
    ['page', 'q', 'roleName', 'sort', 'order'],
    prefix
  )

  const { page, q, roleName, sort, order } = queryObject

  const searchParams: CustomerListQuery = {
    limit: pageSize,
    page: page ? Number(page) : 1,
    q,
    roleName,
    sort: sort as CustomerListQuery['sort'],
    order: order as 'asc' | 'desc' | undefined,
  }

  return { searchParams, raw: queryObject }
}
