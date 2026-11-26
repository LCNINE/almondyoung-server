import { useQueryParams } from '../../use-query-params';
import type { StocktakingSessionQuery } from '@/lib/types/dto/inventory';

type UseStocktakingTableQueryProps = {
  pageSize?: number;
};

export const useStocktakingTableQuery = ({
  pageSize = 20,
}: UseStocktakingTableQueryProps = {}) => {
  // 표의 쪽 이동은 주소의 page 를 바꾼다(use-data-table)
  const queryObject = useQueryParams(['page', 'warehouseId', 'status']);

  const { page, warehouseId, status } = queryObject;

  const searchParams: StocktakingSessionQuery = {
    limit: pageSize,
    offset: (Math.max(1, Math.floor(Number(page)) || 1) - 1) * pageSize,
    warehouseId: warehouseId || undefined,
    status: (status as StocktakingSessionQuery['status']) || undefined,
  };

  return { searchParams, raw: queryObject };
};
