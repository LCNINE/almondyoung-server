'use client';

import { useQuery } from '@tanstack/react-query';
import {
  analyticsApi,
  BehaviorStatisticsQuery,
  CustomerInsightsQuery,
  ProductStatisticsQuery,
  ProfitStatisticsQuery,
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

export const useProfitStatistics = (query: ProfitStatisticsQuery) => {
  return useQuery({
    queryKey: analyticsQueryKeys.profit(query),
    queryFn: () => analyticsApi.getProfitStatistics(query),
    // 페이지 이동 시 이전 페이지를 유지해 테이블이 깜빡이지 않게 한다
    placeholderData: (previous) => previous,
  });
};

export const useCustomerStatistics = (query: StatisticsRangeQuery) => {
  return useQuery({
    queryKey: analyticsQueryKeys.customers(query),
    queryFn: () => analyticsApi.getCustomerStatistics(query),
  });
};

export const useCustomerInsights = (query: CustomerInsightsQuery) => {
  return useQuery({
    queryKey: analyticsQueryKeys.customerInsights(query),
    queryFn: () => analyticsApi.getCustomerInsights(query),
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

export const useBehaviorStatistics = (query: BehaviorStatisticsQuery) => {
  return useQuery({
    queryKey: analyticsQueryKeys.behavior(query),
    queryFn: () => analyticsApi.getBehaviorStatistics(query),
    // GA4 는 외부 API — 서버측 5분 캐시와 맞춰 탭 전환마다 재요청하지 않는다
    staleTime: 5 * 60 * 1000,
  });
};
