import { useQueryParams } from '../../use-query-params';
import type { StockSummaryQuery } from '@/lib/types/dto/inventory';

type UseInventoryStatusTableQueryProps = {
  pageSize?: number;
};

export const useInventoryStatusTableQuery = ({
  pageSize = 20,
}: UseInventoryStatusTableQueryProps = {}) => {
  const queryObject = useQueryParams(['page', 'skuId', 'warehouseId']);

  const { page, skuId, warehouseId } = queryObject;

  const searchParams: StockSummaryQuery = {
    limit: pageSize,
    page: page ? Number(page) : 1,
    skuId: skuId || undefined,
    warehouseId: warehouseId || undefined,
  };

  return { searchParams, raw: queryObject };
};
