import { useQueryParams } from '../../use-query-params';
import type { MastersQuery } from '@/lib/types/dto/products';

const PAGE_SIZE = 20;

type UseProductsMatchingTableQueryProps = {
  pageSize?: number;
};

export const useProductsMatchingTableQuery = ({
  pageSize = PAGE_SIZE,
}: UseProductsMatchingTableQueryProps = {}) => {
  const raw = useQueryParams(['page', 'search', 'status', 'brand', 'categoryId']);

  const { page, search, status, brand, categoryId } = raw;

  const searchParams: MastersQuery = {
    limit: pageSize,
    page: page ? Number(page) : 1,
    q: search?.trim() || undefined,
    status: (status as MastersQuery['status']) || undefined,
    brand: brand || undefined,
    categoryId: categoryId || undefined,
  };

  return { searchParams, raw, pageSize };
};
