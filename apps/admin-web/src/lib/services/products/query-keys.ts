// src/lib/services/products/query-keys.ts
// PIM API 쿼리 키 팩토리

export const productQueryKeys = {
  // 카테고리 관련
  categories: ['categories'] as const,
  categoryTree: () => [...productQueryKeys.categories, 'tree'] as const,
  category: (id: string) => [...productQueryKeys.categories, id] as const,
  categoryChildren: (id: string) =>
    [...productQueryKeys.category(id), 'children'] as const,
  categoryPath: (id: string) =>
    [...productQueryKeys.category(id), 'path'] as const,

  // 제품 마스터 관련
  masters: ['masters'] as const,
  mastersList: (query: Record<string, any>) =>
    [...productQueryKeys.masters, 'list', query] as const,
  master: (id: string) => [...productQueryKeys.masters, id] as const,
  masterPricePreview: (id: string) =>
    [...productQueryKeys.master(id), 'price-preview'] as const,

  // 제품 변형 관련
  variants: ['variants'] as const,
  variantsByMaster: (masterId: string, query: Record<string, any>) =>
    [...productQueryKeys.variants, 'master', masterId, query] as const,
  variant: (id: string) => [...productQueryKeys.variants, id] as const,
  variantPrice: (id: string) =>
    [...productQueryKeys.variant(id), 'price'] as const,
  variantsBatch: (ids: string[]) =>
    [...productQueryKeys.variants, 'batch', ids.slice().sort().join(',')] as const,

  // 판매 채널 관련
  channels: ['channels'] as const,
  channelsList: (query: Record<string, any>) =>
    [...productQueryKeys.channels, 'list', query] as const,
  activeChannels: () => [...productQueryKeys.channels, 'active'] as const,
  channel: (id: string) => [...productQueryKeys.channels, id] as const,
  channelsByType: (type: string) =>
    [...productQueryKeys.channels, 'type', type] as const,

  // 채널별 제품 관련
  channelProducts: ['channel-products'] as const,
  channelProductsByMaster: (masterId: string) =>
    [...productQueryKeys.channelProducts, 'master', masterId] as const,
  channelProductsByChannel: (channelId: string, query: Record<string, any>) =>
    [...productQueryKeys.channelProducts, 'channel', channelId, query] as const,
  channelProduct: (id: string) =>
    [...productQueryKeys.channelProducts, id] as const,
  mergedChannelProduct: (masterId: string, channelId: string) =>
    [
      ...productQueryKeys.channelProducts,
      'merged',
      masterId,
      channelId,
    ] as const,

  // 매칭 테이블 관련
  matchingTable: ['matching-table'] as const,
  matchingTableList: (query: Record<string, any>) =>
    [...productQueryKeys.matchingTable, 'list', query] as const,

  // 기존 호환성 (점진적 마이그레이션용)
  products: ['products'] as const,
  product: (id: string) => ['products', id] as const,
  productVariants: (productId: string) =>
    ['products', productId, 'variants'] as const,
} as const;
