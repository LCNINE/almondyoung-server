import type { ReturnExchangeListQuery } from '@/lib/api/domains/return-exchange';

export const returnExchangeQueryKeys = {
  allExchanges: ['exchange-requests'] as const,
  exchangeList: (q: ReturnExchangeListQuery) =>
    [...returnExchangeQueryKeys.allExchanges, 'list', q] as const,
  exchangeDetail: (id: string) =>
    [...returnExchangeQueryKeys.allExchanges, id] as const,
} as const;
