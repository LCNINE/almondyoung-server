'use client';

import { useQuery } from '@tanstack/react-query';
import {
  analyticsApi,
  ProductStatisticsQuery,
  StatisticsRangeQuery,
  TrafficStatisticsQuery,
} from '@/lib/api/domains/analytics';
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

export const useTrafficStatistics = (query: TrafficStatisticsQuery) => {
  return useQuery({
    queryKey: analyticsQueryKeys.traffic(query),
    queryFn: () => analyticsApi.getTrafficStatistics(query),
    // GA4 는 외부 API — 서버측 5분 캐시와 맞춰 탭 전환마다 재요청하지 않는다
    staleTime: 5 * 60 * 1000,
  });
};
