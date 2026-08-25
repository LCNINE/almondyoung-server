'use client';

import { useQuery } from '@tanstack/react-query';
import { analyticsApi, StatisticsRangeQuery } from '@/lib/api/domains/analytics';
import { analyticsQueryKeys } from './query-keys';

export const useAnalyticsOverview = () => {
  return useQuery({
    queryKey: analyticsQueryKeys.overview(),
    queryFn: () => analyticsApi.getOverview(),
  });
};

export const useSalesStatistics = (query: StatisticsRangeQuery) => {
  return useQuery({
    queryKey: analyticsQueryKeys.sales(query),
    queryFn: () => analyticsApi.getSalesStatistics(query),
  });
};

export const useProductStatistics = (
  query: StatisticsRangeQuery & { sort?: 'revenue' | 'quantity' | 'orders'; limit?: number },
) => {
  return useQuery({
    queryKey: analyticsQueryKeys.products(query),
    queryFn: () => analyticsApi.getProductStatistics(query),
  });
};

export const useCustomerStatistics = (query: StatisticsRangeQuery) => {
  return useQuery({
    queryKey: analyticsQueryKeys.customers(query),
    queryFn: () => analyticsApi.getCustomerStatistics(query),
  });
};
