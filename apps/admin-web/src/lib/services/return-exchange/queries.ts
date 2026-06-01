'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { returnExchangeApi, type ReturnExchangeListQuery } from '@/lib/api/domains/return-exchange';
import { returnExchangeQueryKeys } from './query-keys';

export const useReturnRequests = (query: ReturnExchangeListQuery) => {
  return useQuery({
    queryKey: returnExchangeQueryKeys.returnList(query),
    queryFn: () => returnExchangeApi.listReturnRequests(query),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
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
