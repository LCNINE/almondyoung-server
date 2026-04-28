import { useQueryParams } from '../../use-query-params';

type UseBannerGroupsTableQueryProps = {
  pageSize?: number;
};

export const useBannerGroupsTableQuery = ({
  pageSize = 20,
}: UseBannerGroupsTableQueryProps = {}) => {
  const queryObject = useQueryParams(['page', 'category']);

  const { page, category } = queryObject;

  const searchParams = {
    limit: pageSize,
    offset: page ? (Number(page) - 1) * pageSize : 0,
    category: category || undefined,
  };

  return { searchParams, raw: queryObject };
};
