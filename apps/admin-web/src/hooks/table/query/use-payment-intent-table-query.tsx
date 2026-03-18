import type { PaymentIntentListQuery } from '@/lib/types/dto/wallet';
import { useQueryParams } from '../../use-query-params';

type UsePaymentIntentTableQueryProps = {
  prefix?: string;
  pageSize?: number;
};

export const usePaymentIntentTableQuery = ({
  prefix,
  pageSize = 20,
}: UsePaymentIntentTableQueryProps) => {
  const queryObject = useQueryParams(
    ['page', 'q', 'status', 'paymentMethodType', 'dateFrom', 'dateTo', 'sort', 'order'],
    prefix,
  );

  const { page, q, status, paymentMethodType, dateFrom, dateTo, sort, order } = queryObject;

  const searchParams: PaymentIntentListQuery = {
    limit: pageSize,
    page: page ? Number(page) : 1,
    q,
    status,
    paymentMethodType,
    dateFrom,
    dateTo,
    sort,
    order,
  };

  return { searchParams, raw: queryObject };
};
