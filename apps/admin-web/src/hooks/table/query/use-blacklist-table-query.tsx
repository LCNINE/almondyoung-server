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
  const queryObject = useQueryParams(['page', 'userId'], prefix);

  const { page, userId } = queryObject;

  const searchParams: BlacklistListQuery = {
    limit: pageSize,
    page: page ? Number(page) : 1,
    userId,
  };

  return { searchParams, raw: queryObject };
};
