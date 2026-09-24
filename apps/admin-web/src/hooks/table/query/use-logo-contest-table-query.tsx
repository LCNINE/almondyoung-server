import { AdminLogoContestEntryListQuery } from '@/lib/types/dto/logo-contest';
import { useQueryParams } from '../../use-query-params';

type UseLogoContestTableQueryProps = {
  prefix?: string;
  pageSize?: number;
};

export const useLogoContestTableQuery = ({
  prefix,
  pageSize = 20,
}: UseLogoContestTableQueryProps) => {
  const queryObject = useQueryParams(['page', 'status', 'sort', 'q'], prefix);
  const { page, status, sort, q } = queryObject;

  const searchParams: AdminLogoContestEntryListQuery = {
    page: page ? Number(page) : 1,
    limit: pageSize,
    status: status as AdminLogoContestEntryListQuery['status'],
    sort: sort === 'latest' ? 'latest' : 'popular',
    q,
  };

  return { searchParams, raw: queryObject };
};
