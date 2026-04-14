import { useQueryParams } from '../../use-query-params';

type UseCategoryTableQueryProps = {
  prefix?: string;
  pageSize?: number;
};

export const useCategoryTableQuery = ({
  prefix,
  pageSize = 20,
}: UseCategoryTableQueryProps = {}) => {
  const queryObject = useQueryParams(
    ['page', 'q', 'isActive', 'sort', 'order'],
    prefix
  );

  const { page, q, isActive, sort, order } = queryObject;

  const searchParams = {
    limit: pageSize,
    page: page ? Number(page) : 1,
    q,
    isActive: isActive === 'true' ? true : isActive === 'false' ? false : undefined,
    sort,
    order,
  };

  return { searchParams, raw: queryObject };
};
