import { useQueryParams } from '../../use-query-params';
import type { InboundReceiptsQuery } from '@/lib/types/dto/inventory';

const PAGE_SIZE = 20;

export const useInboundHistoryTableQuery = () => {
  const queryObject = useQueryParams(['page', 'warehouseId', 'skuId', 'method', 'startDate', 'endDate']);
  const { page, warehouseId, skuId, method, startDate, endDate } = queryObject;

  const searchParams: InboundReceiptsQuery = {
    limit: PAGE_SIZE,
    offset: page ? (Number(page) - 1) * PAGE_SIZE : 0,
    warehouseId: warehouseId ?? undefined,
    skuId: skuId ?? undefined,
    method: (method as InboundReceiptsQuery['method']) || undefined,
    startDate: startDate ?? undefined,
    endDate: endDate ?? undefined,
  };

  return { searchParams, raw: queryObject };
};
