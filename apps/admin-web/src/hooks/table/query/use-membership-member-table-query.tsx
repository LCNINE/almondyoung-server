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
    ['page', 'q', 'memberQ', 'status', 'dateFrom', 'dateTo', 'dateCriteria'],
    prefix,
  );

  const { page, q, memberQ, status, dateFrom, dateTo, dateCriteria } = queryObject;

  const searchParams: AdminMembersQuery = {
    limit: pageSize,
    page: page ? Number(page) : 1,
    q,
    status,
    dateFrom,
    dateTo,
    dateCriteria: (dateCriteria === 'createdAt' || dateCriteria === 'cancelledAt') ? dateCriteria : undefined,
  };

  return { searchParams, memberQ: memberQ ?? '', raw: queryObject };
};
