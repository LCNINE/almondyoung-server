import { useQueryParams } from '../../use-query-params';

export const useInboundPendingTableQuery = () => {
  const queryObject = useQueryParams(['warehouseId']);
  const { warehouseId } = queryObject;

  return { warehouseId: warehouseId ?? undefined, raw: queryObject };
};
