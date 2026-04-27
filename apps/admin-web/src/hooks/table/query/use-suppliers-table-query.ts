import { useQueryParams } from '../../use-query-params';
import type { SupplierFiltersDto } from '@/lib/types/dto/inventory';

type UseSupplierTableQueryProps = {
  pageSize?: number;
};

export const useSuppliersTableQuery = ({
  pageSize = 20,
}: UseSupplierTableQueryProps = {}) => {
  const queryObject = useQueryParams(['page', 'search', 'categoryId', 'purchaseManagerId']);

  const { page, search, categoryId, purchaseManagerId } = queryObject;

  const searchParams: SupplierFiltersDto = {
    limit: pageSize,
    page: page ? Number(page) : 1,
    search: search || undefined,
    categoryId: categoryId || undefined,
    purchaseManagerId: purchaseManagerId || undefined,
  };

  return { searchParams, raw: queryObject };
};
