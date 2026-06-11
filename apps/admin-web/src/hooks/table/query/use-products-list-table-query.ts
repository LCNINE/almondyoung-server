import type { MastersQuery } from '@/lib/types/dto/products';
import { useQueryParams } from '../../use-query-params';

type UseProductsListTableQueryProps = {
  pageSize?: number;
};

export const useProductsListTableQuery = ({
  pageSize = 20,
}: UseProductsListTableQueryProps = {}) => {
  const queryObject = useQueryParams(['page', 'q', 'categoryId', 'brand', 'mode']);

  const { page, q, categoryId, brand, mode } = queryObject;

  const searchParams: MastersQuery = {
    limit: pageSize,
    page: page ? Number(page) : 1,
    q: q?.trim() || undefined,
    categoryId,
    brand,
    mode: mode === 'active-or-inactive' ? mode : undefined,
  };

  return { searchParams, raw: queryObject };
};
