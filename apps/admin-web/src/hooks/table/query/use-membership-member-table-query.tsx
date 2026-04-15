import { AdminMembersQuery } from '@/lib/api/domains/membership';
import { useQueryParams } from '../../use-query-params';

type UseMembershipMemberTableQueryProps = {
  prefix?: string;
  pageSize?: number;
};

export const useMembershipMemberTableQuery = ({
  prefix,
  pageSize = 20,
}: UseMembershipMemberTableQueryProps) => {
  const queryObject = useQueryParams(
    ['page', 'q', 'status', 'dateFrom', 'dateTo'],
    prefix,
  );

  const { page, q, status, dateFrom, dateTo } = queryObject;

  const searchParams: AdminMembersQuery = {
    limit: pageSize,
    page: page ? Number(page) : 1,
    q,
    status,
    dateFrom,
    dateTo,
  };

  return { searchParams, raw: queryObject };
};
