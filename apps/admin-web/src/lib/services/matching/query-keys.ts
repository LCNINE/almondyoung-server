// src/lib/services/matching/query-keys.ts

export const matchingQueryKeys = {
  all: ['matchings'] as const,

  lists: () => [...matchingQueryKeys.all, 'list'] as const,
  list: (query: unknown) => [...matchingQueryKeys.lists(), query] as const,

  legacyIgnoredLists: () =>
    [...matchingQueryKeys.all, 'legacy-ignored'] as const,
  legacyIgnoredList: (query: unknown) =>
    [...matchingQueryKeys.legacyIgnoredLists(), query] as const,

  orderLineLists: () => [...matchingQueryKeys.all, 'order-lines'] as const,
  orderLines: (query: unknown) =>
    [...matchingQueryKeys.orderLineLists(), query] as const,

  details: () => [...matchingQueryKeys.all, 'detail'] as const,
  detail: (id: string) => [...matchingQueryKeys.details(), id] as const,

  variantMatchings: () => [...matchingQueryKeys.all, 'variant'] as const,
  variantMatching: (variantId: string) =>
    [...matchingQueryKeys.variantMatchings(), variantId] as const,

  variantMatchingBatches: () =>
    [...matchingQueryKeys.all, 'variant-batch'] as const,
  variantMatchingBatch: (variantIds: string[]) =>
    [...matchingQueryKeys.variantMatchingBatches(), variantIds] as const,

  stockPolicies: () => [...matchingQueryKeys.all, 'stock-policy'] as const,
  stockPolicy: (variantId: string) =>
    [...matchingQueryKeys.stockPolicies(), variantId] as const,

  skuLookups: () => [...matchingQueryKeys.all, 'sku-lookup'] as const,
  skuLookup: (variantId: string, options: unknown) =>
    [...matchingQueryKeys.skuLookups(), variantId, options] as const,

  mastersBatchStats: (masterIds: string[]) =>
    [...matchingQueryKeys.all, 'masters-batch-stats', masterIds] as const,
} as const;
