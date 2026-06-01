import type { ReturnExchangeListQuery } from '@/lib/api/domains/return-exchange';

export const returnExchangeQueryKeys = {
  allReturns: ['return-requests'] as const,
  returnList: (q: ReturnExchangeListQuery) => [...returnExchangeQueryKeys.allReturns, 'list', q] as const,
  returnDetail: (id: string) => [...returnExchangeQueryKeys.allReturns, id] as const,
  allExchanges: ['exchange-requests'] as const,
  exchangeList: (q: ReturnExchangeListQuery) => [...returnExchangeQueryKeys.allExchanges, 'list', q] as const,
  exchangeDetail: (id: string) => [...returnExchangeQueryKeys.allExchanges, id] as const,
} as const;
