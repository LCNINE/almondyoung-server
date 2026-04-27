import { useQueryParams } from '../../use-query-params';
import type { PurchaseOrderListFilters } from '@/lib/types/dto/inventory';

type UsePurchaseOrdersTableQueryProps = {
  pageSize?: number;
};

export const usePurchaseOrdersTableQuery = ({
  pageSize = 20,
}: UsePurchaseOrdersTableQueryProps = {}) => {
  const queryObject = useQueryParams(['page', 'status', 'type']);

  const { page, status, type } = queryObject;

  const searchParams: PurchaseOrderListFilters = {
    limit: pageSize,
    offset: page ? (Number(page) - 1) * pageSize : 0,
    status: (status as PurchaseOrderListFilters['status']) || undefined,
    type: (type as PurchaseOrderListFilters['type']) || undefined,
  };

  return { searchParams, raw: queryObject };
};
