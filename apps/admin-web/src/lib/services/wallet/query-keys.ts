import type {
  PaymentIntentListQuery,
  RefundListQuery,
} from '@/lib/types/dto/wallet';

export const walletQueryKeys = {
  all: ['wallet'] as const,

  // Payment intents
  intents: () => [...walletQueryKeys.all, 'intents'] as const,
  intentList: (query: PaymentIntentListQuery) =>
    [...walletQueryKeys.intents(), 'list', query] as const,
  intentDetail: (id: string) => [...walletQueryKeys.intents(), id] as const,
  stateTransitions: (id: string) =>
    [...walletQueryKeys.intents(), id, 'state-transitions'] as const,

  // Refunds
  refunds: () => [...walletQueryKeys.all, 'refunds'] as const,
  refundList: (query: RefundListQuery) =>
    [...walletQueryKeys.refunds(), 'list', query] as const,

  // Bank transfers
  bankTransfers: () => [...walletQueryKeys.all, 'bank-transfers'] as const,
  bankTransferList: (page?: number, limit?: number) =>
    [...walletQueryKeys.bankTransfers(), 'list', { page, limit }] as const,

  // Points
  points: () => [...walletQueryKeys.all, 'points'] as const,
  pointsBalance: (userId: string) =>
    [...walletQueryKeys.points(), 'balance', userId] as const,
  pointsEvents: (userId: string, page?: number, limit?: number) =>
    [...walletQueryKeys.points(), 'events', userId, { page, limit }] as const,
  pointsStats: (params?: { dateFrom?: string; dateTo?: string }) =>
    [...walletQueryKeys.points(), 'stats', params] as const,
  allPointsEvents: (params: object) =>
    [...walletQueryKeys.points(), 'events', 'all', params] as const,
  topUsers: (limit?: number) =>
    [...walletQueryKeys.points(), 'users', 'top', { limit }] as const,

  // Payment method catalog
  catalog: () => [...walletQueryKeys.all, 'catalog'] as const,

  // Regions
  regions: () => [...walletQueryKeys.all, 'regions'] as const,
  regionMethods: (code: string) =>
    [...walletQueryKeys.regions(), code, 'payment-methods'] as const,
} as const;
