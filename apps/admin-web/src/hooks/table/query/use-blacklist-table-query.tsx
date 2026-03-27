import { BlacklistListQuery } from '@/lib/api/domains/blacklists';
import { useQueryParams } from '../../use-query-params';

type UseBlacklistTableQueryProps = {
  prefix?: string;
  pageSize?: number;
};

export const useBlacklistTableQuery = ({
  prefix,
  pageSize = 20,
}: UseBlacklistTableQueryProps) => {
  const queryObject = useQueryParams(['page', 'userId', 'q'], prefix);

  const { page, userId, q } = queryObject;

  const searchParams: BlacklistListQuery = {
    limit: pageSize,
    page: page ? Number(page) : 1,
    userId,
    q,
  };

  return { searchParams, raw: queryObject };
};
