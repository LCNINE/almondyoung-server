import type {
  FulfillmentOrdersQuery,
  FulfillmentOrderStatus,
} from '@/lib/types/dto/fulfillment';
import { useQueryParams } from '../../use-query-params';

type UseFulfillmentsTableQueryProps = {
  prefix?: string;
  pageSize?: number;
};

export const useFulfillmentsTableQuery = ({
  prefix,
  pageSize = 20,
}: UseFulfillmentsTableQueryProps) => {
  const queryObject = useQueryParams(['page', 'status'], prefix);
  const { page, status } = queryObject;

  const searchParams: FulfillmentOrdersQuery = {
    limit: pageSize,
    page: page ? Number(page) : 1,
    // URL status 문자열 → enum (잘못된 값은 백엔드에서 무시됨)
    status: (status || undefined) as FulfillmentOrderStatus | undefined,
  };

  return { searchParams, raw: queryObject };
};
