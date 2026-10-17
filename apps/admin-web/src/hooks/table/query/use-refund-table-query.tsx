import type { RefundListQuery } from '@/lib/types/dto/wallet';
import { useQueryParams } from '../../use-query-params';

type UseRefundTableQueryProps = {
  prefix?: string;
  pageSize?: number;
};

export const useRefundTableQuery = ({
  prefix,
  pageSize = 20,
}: UseRefundTableQueryProps) => {
  const queryObject = useQueryParams(
    ['page', 'status', 'kind', 'intentId', 'dateFrom', 'dateTo'],
    prefix,
  );

  const { page, status, kind, intentId, dateFrom, dateTo } = queryObject;

  const searchParams: RefundListQuery = {
    limit: pageSize,
    page: page ? Number(page) : 1,
    status,
    kind,
    intentId,
    dateFrom,
    dateTo,
  };

  return { searchParams, raw: queryObject };
};
