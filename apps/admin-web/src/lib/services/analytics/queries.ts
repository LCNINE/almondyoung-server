'use client';

import { useQuery } from '@tanstack/react-query';
import {
  analyticsApi,
  BehaviorStatisticsQuery,
  CustomerInsightsQuery,
  ItemBehaviorQuery,
  ProductDiagnosisQuery,
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
    // 페이지 이동 시 이전 페이지를 유지해 테이블이 깜빡이지 않게 한다
    placeholderData: (previous) => previous,
  });
};

export const useUnsoldProducts = (query: StatisticsRangeQuery & { limit?: number; page?: number }) => {
  return useQuery({
    queryKey: analyticsQueryKeys.unsoldProducts(query),
    queryFn: () => analyticsApi.getUnsoldProducts(query),
    placeholderData: (previous) => previous,
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
    placeholderData: (previous) => previous,
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

/**
 * 실시간 접속. 서버가 20초 캐시하므로 화면도 그 주기로 다시 묻는다.
 * `enabled` 로 폴링을 끌 수 있게 열어 둔다 — 탭이 안 보일 때 계속 부르면 GA4 쿼터만 축낸다.
 */
export const useRealtimeTraffic = (options?: { limit?: number; enabled?: boolean }) => {
  const limit = options?.limit ?? 10;
  return useQuery({
    queryKey: analyticsQueryKeys.realtime(limit),
    queryFn: () => analyticsApi.getRealtimeTraffic(limit),
    enabled: options?.enabled ?? true,
    refetchInterval: 20 * 1000,
    staleTime: 20 * 1000,
  });
};

export const useOperatingCosts = () => {
  return useQuery({
    queryKey: analyticsQueryKeys.operatingCosts(),
    queryFn: () => analyticsApi.listOperatingCosts(),
    staleTime: 60 * 1000,
  });
};

/**
 * 상품 단건 진단(카르테)의 매출·마진 축. masterId 가 비면 조회하지 않는다 —
 * 라우트 파라미터가 아직 안 잡힌 첫 렌더에서 400 을 부르지 않기 위함이다.
 */
export const useProductDiagnosis = (query: ProductDiagnosisQuery) => {
  return useQuery({
    queryKey: analyticsQueryKeys.productDiagnosis(query),
    queryFn: () => analyticsApi.getProductDiagnosis(query),
    enabled: Boolean(query.masterId),
  });
};

/** 상품 단건 GA4 행동. itemId(Medusa product id) 를 아직 모르면 조회하지 않는다. */
export const useItemBehavior = (query: ItemBehaviorQuery, options?: { enabled?: boolean }) => {
  return useQuery({
    queryKey: analyticsQueryKeys.itemBehavior(query),
    queryFn: () => analyticsApi.getItemBehavior(query),
    enabled: (options?.enabled ?? true) && Boolean(query.itemId),
  });
};
