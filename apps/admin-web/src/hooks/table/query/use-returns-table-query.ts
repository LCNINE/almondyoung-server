import { useQueryParams } from '../../use-query-params';
import type { ReturnFiltersDto, ReturnStatus } from '@/lib/types/dto/inventory';

const PAGE_SIZE = 20;

export const useReturnsTableQuery = () => {
  const queryObject = useQueryParams(['page', 'warehouseId', 'status', 'orderId']);
  const { page, warehouseId, status, orderId } = queryObject;

  const searchParams: ReturnFiltersDto = {
    limit: PAGE_SIZE,
    offset: page ? (Number(page) - 1) * PAGE_SIZE : 0,
    warehouseId: warehouseId ?? undefined,
    status: (status as ReturnStatus) || undefined,
    orderId: orderId ?? undefined,
  };

  return { searchParams, raw: queryObject };
};
