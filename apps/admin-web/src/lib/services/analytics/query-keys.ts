import {
  BehaviorStatisticsQuery,
  ItemBehaviorQuery,
  ProductDiagnosisQuery,
  CustomerInsightsQuery,
  ProfitStatisticsQuery,
  StatisticsRangeQuery,
  TrafficStatisticsQuery,
} from '@/lib/api/domains/analytics';

export const analyticsQueryKeys = {
  all: ['analytics'] as const,
  overview: () => [...analyticsQueryKeys.all, 'overview'] as const,
  sales: (query: StatisticsRangeQuery) => [...analyticsQueryKeys.all, 'sales', query] as const,
  products: (query: StatisticsRangeQuery & { sort?: string; limit?: number; order?: string }) =>
    [...analyticsQueryKeys.all, 'products', query] as const,
  unsoldProducts: (query: StatisticsRangeQuery & { limit?: number }) =>
    [...analyticsQueryKeys.all, 'unsold-products', query] as const,
  customers: (query: StatisticsRangeQuery) => [...analyticsQueryKeys.all, 'customers', query] as const,
  profit: (query: ProfitStatisticsQuery) => [...analyticsQueryKeys.all, 'profit', query] as const,
  traffic: (query: TrafficStatisticsQuery) => [...analyticsQueryKeys.all, 'traffic', query] as const,
  customerInsights: (query: CustomerInsightsQuery) => [...analyticsQueryKeys.all, 'customer-insights', query] as const,
  behavior: (query: BehaviorStatisticsQuery) => [...analyticsQueryKeys.all, 'behavior', query] as const,
  productDiagnosis: (query: ProductDiagnosisQuery) =>
    [...analyticsQueryKeys.all, 'product-diagnosis', query] as const,
  itemBehavior: (query: ItemBehaviorQuery) => [...analyticsQueryKeys.all, 'item-behavior', query] as const,
  realtime: (limit: number) => [...analyticsQueryKeys.all, 'realtime', { limit }] as const,
  operatingCosts: () => [...analyticsQueryKeys.all, 'operating-costs'] as const,
};
