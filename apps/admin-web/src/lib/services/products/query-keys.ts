// src/lib/services/products/query-keys.ts
// PIM API 쿼리 키 팩토리

export const productQueryKeys = {
  // 카테고리 관련
  categories: ['categories'] as const,
  categoryTree: (options?: { maxDepth?: number; includeInactive?: boolean }) =>
    [
      ...productQueryKeys.categories,
      'tree',
      options?.maxDepth ?? 'all',
      options?.includeInactive ? 'all-states' : 'active-only',
    ] as const,
  category: (id: string) => [...productQueryKeys.categories, id] as const,
  categoryChildren: (id: string) =>
    [...productQueryKeys.category(id), 'children'] as const,
  categoryPath: (id: string) =>
    [...productQueryKeys.category(id), 'path'] as const,

  // 제품 마스터 관련
  masters: ['masters'] as const,
  mastersList: (query: Record<string, any>) =>
    [...productQueryKeys.masters, 'list', query] as const,
  mastersSummaryList: (query: Record<string, any>) =>
    [...productQueryKeys.masters, 'summary-list', query] as const,
  mastersBatch: (ids: string[]) =>
    [
      ...productQueryKeys.masters,
      'batch',
      ids.slice().sort().join(','),
    ] as const,
  master: (id: string) => [...productQueryKeys.masters, id] as const,
  masterPricePreview: (id: string) =>
    [...productQueryKeys.master(id), 'price-preview'] as const,

  // 제품 변형 관련
  variants: ['variants'] as const,
  variantsByMaster: (masterId: string, query: Record<string, any>) =>
    [...productQueryKeys.variants, 'master', masterId, query] as const,
  variantsByMasterVersion: (
    masterId: string,
    versionId: string,
    query: Record<string, any>
  ) =>
    [
      ...productQueryKeys.variants,
      'master',
      masterId,
      'version',
      versionId,
      query,
    ] as const,
  variant: (id: string) => [...productQueryKeys.variants, id] as const,
  variantPrice: (id: string) =>
    [...productQueryKeys.variant(id), 'price'] as const,
  variantsBatch: (ids: string[]) =>
    [
      ...productQueryKeys.variants,
      'batch',
      ids.slice().sort().join(','),
    ] as const,

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

  // 배너 그룹 관련
  bannerGroups: ['banner-groups'] as const,
  bannerGroupsList: (query: object) =>
    [...productQueryKeys.bannerGroups, 'list', query] as const,
  bannerGroup: (id: string) => [...productQueryKeys.bannerGroups, id] as const,

  // 배너 관련
  banners: ['banners'] as const,
  bannersByGroup: (groupId: string) =>
    [...productQueryKeys.banners, 'group', groupId] as const,
  banner: (id: string) => [...productQueryKeys.banners, id] as const,

  // 공지사항 관련
  notices: ['notices'] as const,
  noticesList: <T extends object>(query: T) =>
    [...productQueryKeys.notices, 'list', query] as const,
  notice: (id: string) => [...productQueryKeys.notices, id] as const,

  // 태그 그룹 관련
  tagGroups: ['tag-groups'] as const,
  tagGroupsList: (query: object) =>
    [...productQueryKeys.tagGroups, 'list', query] as const,
  tagGroup: (id: string) => [...productQueryKeys.tagGroups, id] as const,

  // 태그 값 관련
  tagValues: (groupId: string) =>
    [...productQueryKeys.tagGroup(groupId), 'values'] as const,

  // 가격 관리 관련
  pricingVersion: (versionId: string) =>
    ['pricing', 'versions', versionId] as const,
  pricingVersionRules: (versionId: string) =>
    [...productQueryKeys.pricingVersion(versionId), 'rules'] as const,
  pricingVersionPriceSet: (versionId: string, variantId: string) =>
    [
      ...productQueryKeys.pricingVersion(versionId),
      'price-set',
      variantId,
    ] as const,
  pricingMasterRules: (masterId: string) =>
    ['pricing', 'masters', masterId, 'rules'] as const,
  pricingMasterPriceSet: (masterId: string, variantId: string) =>
    ['pricing', 'masters', masterId, 'price-set', variantId] as const,

  // 버전 관련
  masterVersions: (masterId: string) => ['master-versions', masterId] as const,
  versionDetail: (masterId: string, versionId: string) =>
    ['master-versions', masterId, 'detail', versionId] as const,
  versionDetailRaw: (masterId: string, versionId: string) =>
    [...productQueryKeys.versionDetail(masterId, versionId), 'raw'] as const,

  // 채널 리스팅 관련
  channelListingsByVariant: (variantId: string) =>
    ['channel-listings', 'by-variant', variantId] as const,
  channelListing: (id: string) => ['channel-listings', id] as const,

  // 채널 카테고리 관련
  channelCategories: ['channel-categories'] as const,
  channelCategory: (id: string) => ['channel-categories', id] as const,

  // 감사 로그 관련
  auditRecent: (limit: number) => ['audit', 'recent', limit] as const,
  auditByUser: (userId: string, limit: number) =>
    ['audit', 'by-user', userId, limit] as const,
  auditByAction: (action: string, limit: number) =>
    ['audit', 'by-action', action, limit] as const,
  auditProduct: (masterId: string) => ['audit', 'product', masterId] as const,

  // 승인 관련
  pendingApprovals: ['approval', 'pending'] as const,
  approvalHistory: (masterId: string) =>
    ['approval', 'history', masterId] as const,
} as const;
