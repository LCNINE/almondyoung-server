import { useQueryParams } from '../../use-query-params';

export const usePointsEventsTableQuery = (pageSize = 20) => {
  const { page, dateFrom, dateTo, userId, eventType } = useQueryParams(
    ['page', 'dateFrom', 'dateTo', 'userId', 'eventType'],
  );

  return {
    page: page ? Number(page) : 1,
    limit: pageSize,
    dateFrom,
    dateTo,
    userId,
    eventType,
  };
};
