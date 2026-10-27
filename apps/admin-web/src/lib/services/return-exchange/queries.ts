'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  returnExchangeApi,
  type ReturnExchangeListQuery,
} from '@/lib/api/domains/return-exchange';
import { returnExchangeQueryKeys } from './query-keys';

export const useExchangeRequests = (query: ReturnExchangeListQuery, options: { enabled?: boolean } = {}) => {
  return useQuery({
    enabled: options.enabled ?? true,
    queryKey: returnExchangeQueryKeys.exchangeList(query),
    queryFn: () => returnExchangeApi.listExchangeRequests(query),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  });
};
