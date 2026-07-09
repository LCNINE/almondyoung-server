import { useQueryParams } from '../../use-query-params';
import type { StockSummaryQuery } from '@/lib/types/dto/inventory';

type UseInventoryStatusTableQueryProps = {
  pageSize?: number;
};

export const useInventoryStatusTableQuery = ({
  pageSize = 20,
}: UseInventoryStatusTableQueryProps = {}) => {
  const queryObject = useQueryParams(['page', 'skuId', 'warehouseId', 'q']);

  const { page, skuId, warehouseId, q } = queryObject;

  const searchParams: StockSummaryQuery = {
    limit: pageSize,
    page: page ? Number(page) : 1,
    skuId: skuId || undefined,
    warehouseId: warehouseId || undefined,
    search: q || undefined,
  };

  return { searchParams, raw: queryObject };
};
