import type { MastersQuery, ProductStatus } from '@/lib/types/dto/products';
import { useQueryParams } from '../../use-query-params';

type UseProductsListTableQueryProps = {
  pageSize?: number;
};

export const useProductsListTableQuery = ({
  pageSize = 20,
}: UseProductsListTableQueryProps = {}) => {
  const queryObject = useQueryParams(['page', 'q', 'status', 'categoryId', 'brand']);

  const { page, q, status, categoryId, brand } = queryObject;

  const searchParams: MastersQuery = {
    limit: pageSize,
    page: page ? Number(page) : 1,
    search: q,
    status: status as ProductStatus | undefined,
    categoryId,
    brand,
  };

  return { searchParams, raw: queryObject };
};
