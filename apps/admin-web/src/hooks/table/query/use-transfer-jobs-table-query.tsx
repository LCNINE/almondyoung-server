import { useQueryParams } from '../../use-query-params';
import type { TransferJobQuery } from '@/lib/types/dto/inventory';

type UseTransferJobsTableQueryProps = {
  pageSize?: number;
};

export const useTransferJobsTableQuery = ({
  pageSize = 20,
}: UseTransferJobsTableQueryProps = {}) => {
  const queryObject = useQueryParams(['offset', 'warehouseId']);

  const { offset, warehouseId } = queryObject;

  const searchParams: TransferJobQuery = {
    limit: pageSize,
    offset: offset ? Number(offset) : 0,
    warehouseId: warehouseId || undefined,
  };

  return { searchParams, raw: queryObject };
};
