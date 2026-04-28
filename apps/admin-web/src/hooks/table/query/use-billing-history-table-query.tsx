import { AdminBillingHistoryQuery } from '@/lib/api/domains/membership';
import { useQueryParams } from '../../use-query-params';

export const useBillingHistoryTableQuery = (pageSize = 20) => {
  const { page, dateFrom, dateTo, userId, contractId, eventType } = useQueryParams(
    ['page', 'dateFrom', 'dateTo', 'userId', 'contractId', 'eventType'],
  );

  const searchParams: AdminBillingHistoryQuery = {
    limit: pageSize,
    page: page ? Number(page) : 1,
    dateFrom,
    dateTo,
    userId,
    contractId,
    eventType,
  };

  return searchParams;
};
