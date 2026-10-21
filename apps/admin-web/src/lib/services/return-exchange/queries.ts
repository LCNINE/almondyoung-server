'use client';

import {
  keepPreviousData,
  useQuery,
  type QueryClient,
} from '@tanstack/react-query';
import {
  returnExchangeApi,
  type ReturnExchangeListQuery,
} from '@/lib/api/domains/return-exchange';
import { returnExchangeQueryKeys } from './query-keys';

export const useReturnRequests = (query: ReturnExchangeListQuery, options: { enabled?: boolean } = {}) => {
  return useQuery({
    enabled: options.enabled ?? true,
    queryKey: returnExchangeQueryKeys.returnList(query),
    queryFn: () => returnExchangeApi.listReturnRequests(query),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  });
};

export const useReturnEligibility = (orderId: string) => {
  return useQuery({
    queryKey: returnExchangeQueryKeys.returnEligibility(orderId),
    queryFn: () => returnExchangeApi.getReturnEligibility(orderId),
    enabled: !!orderId,
  });
};

export const useChannelOrderReturnEligibility = (channelOrderId: string) => {
  return useQuery({
    queryKey:
      returnExchangeQueryKeys.channelOrderReturnEligibility(channelOrderId),
    queryFn: () =>
      returnExchangeApi.getReturnEligibilityByChannelOrder(channelOrderId),
    enabled: !!channelOrderId,
  });
};

export const useExchangeRequests = (query: ReturnExchangeListQuery, options: { enabled?: boolean } = {}) => {
  return useQuery({
    enabled: options.enabled ?? true,
    queryKey: returnExchangeQueryKeys.exchangeList(query),
    queryFn: () => returnExchangeApi.listExchangeRequests(query),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  });
};

// 「완료 처리」 클릭 때 한 번 부른다 — 행마다 훅을 두지 않는다. 금액 판단이라 캐시를 믿지 않는다.
export function fetchReturnRefundQuote(qc: QueryClient, id: string) {
  return qc.fetchQuery({
    queryKey: returnExchangeQueryKeys.returnRefundQuote(id),
    queryFn: () => returnExchangeApi.getReturnRefundQuote(id),
    staleTime: 0,
  });
}
