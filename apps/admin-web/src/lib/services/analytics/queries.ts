'use client';

import { useQuery } from '@tanstack/react-query';
import { analyticsApi, ProductStatisticsQuery, StatisticsRangeQuery } from '@/lib/api/domains/analytics';
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

export const useProductStatistics = (query: ProductStatisticsQuery) => {
  return useQuery({
    queryKey: analyticsQueryKeys.products(query),
    queryFn: () => analyticsApi.getProductStatistics(query),
  });
};

export const useUnsoldProducts = (query: StatisticsRangeQuery & { limit?: number }) => {
  return useQuery({
    queryKey: analyticsQueryKeys.unsoldProducts(query),
    queryFn: () => analyticsApi.getUnsoldProducts(query),
  });
};

export const useCustomerStatistics = (query: StatisticsRangeQuery) => {
  return useQuery({
    queryKey: analyticsQueryKeys.customers(query),
    queryFn: () => analyticsApi.getCustomerStatistics(query),
  });
};
