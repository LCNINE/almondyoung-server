import { useQueryParams } from '../../use-query-params';
import type { StocktakingSessionQuery } from '@/lib/types/dto/inventory';

type UseStocktakingTableQueryProps = {
  pageSize?: number;
};

export const useStocktakingTableQuery = ({
  pageSize = 20,
}: UseStocktakingTableQueryProps = {}) => {
  const queryObject = useQueryParams(['offset', 'warehouseId', 'status']);

  const { offset, warehouseId, status } = queryObject;

  const searchParams: StocktakingSessionQuery = {
    limit: pageSize,
    offset: offset ? Number(offset) : 0,
    warehouseId: warehouseId || undefined,
    status: (status as StocktakingSessionQuery['status']) || undefined,
  };

  return { searchParams, raw: queryObject };
};
