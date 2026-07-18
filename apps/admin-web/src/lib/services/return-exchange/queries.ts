'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  returnExchangeApi,
  type ReturnExchangeListQuery,
} from '@/lib/api/domains/return-exchange';
import { returnExchangeQueryKeys } from './query-keys';

export const useReturnRequests = (query: ReturnExchangeListQuery) => {
  return useQuery({
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

export const useExchangeRequests = (query: ReturnExchangeListQuery) => {
  return useQuery({
    queryKey: returnExchangeQueryKeys.exchangeList(query),
    queryFn: () => returnExchangeApi.listExchangeRequests(query),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  });
};
