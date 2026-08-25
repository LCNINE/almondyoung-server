import { StatisticsRangeQuery } from '@/lib/api/domains/analytics';

export const analyticsQueryKeys = {
  all: ['analytics'] as const,
  overview: () => [...analyticsQueryKeys.all, 'overview'] as const,
  sales: (query: StatisticsRangeQuery) => [...analyticsQueryKeys.all, 'sales', query] as const,
  products: (query: StatisticsRangeQuery & { sort?: string; limit?: number }) =>
    [...analyticsQueryKeys.all, 'products', query] as const,
  customers: (query: StatisticsRangeQuery) => [...analyticsQueryKeys.all, 'customers', query] as const,
};
