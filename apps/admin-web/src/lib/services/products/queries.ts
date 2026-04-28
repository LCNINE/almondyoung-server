// src/lib/services/products/queries.ts
// PIM API 쿼리 훅

'use client';

import { useQuery } from '@tanstack/react-query';
import { productQueryKeys } from './query-keys';
import { products } from '@/lib/api/domains';
import type {
  CategoryDto,
  CategoryTreeResponseDto,
  CategoryPathResponseDto,
  MasterDto,
  MastersQuery,
  MastersResponseDto,
  PricePreviewDto,
  VariantDto,
  VariantsQuery,
  VariantsResponseDto,
  VariantPriceDto,
  ChannelDto,
  ChannelsQuery,
  ChannelsResponseDto,
  ActiveChannelsResponseDto,
  ChannelProductDto,
  ChannelProductsQuery,
  ChannelProductsResponseDto,
  MasterChannelProductsResponseDto,
  MergedChannelProductDto,
  MatchingTableRowDto,
} from '@/lib/types/dto/products';
import type { BatchVariantInfo } from '@/lib/api/domains/products/variants.client';

// ===== 카테고리 관련 쿼리 =====

/**
 * 카테고리 트리 조회
 */
export const useCategoryTree = (maxDepth?: number) => {
  return useQuery({
    queryKey: productQueryKeys.categoryTree(),
    queryFn: () => products.categories.getTree(maxDepth),
    staleTime: 5 * 60 * 1000, // 5분
    gcTime: 10 * 60 * 1000, // 10분
  });
};

/**
 * 카테고리 상세 조회
 */
export const useCategory = (id: string) => {
  return useQuery({
    queryKey: productQueryKeys.category(id),
    queryFn: () => products.categories.get(id),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
};

/**
 * 하위 카테고리 조회
 */
export const useCategoryChildren = (id: string) => {
  return useQuery({
    queryKey: productQueryKeys.categoryChildren(id),
    queryFn: () => products.categories.getChildren(id),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
};

/**
 * 카테고리 경로 조회
 */
export const useCategoryPath = (id: string) => {
  return useQuery({
    queryKey: productQueryKeys.categoryPath(id),
    queryFn: () => products.categories.getPath(id),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
};

// ===== 제품 마스터 관련 쿼리 =====

/**
 * 제품 마스터 목록 조회
 */
export const useMasters = (query: MastersQuery = {}) => {
  return useQuery({
    queryKey: productQueryKeys.mastersList(query),
    queryFn: () => products.masters.getList(query),
    staleTime: 30 * 1000, // 30초
    gcTime: 5 * 60 * 1000, // 5분
  });
};

/**
 * 제품 마스터 상세 조회
 */
export const useMaster = (id: string) => {
  return useQuery({
    queryKey: productQueryKeys.master(id),
    queryFn: () => products.masters.get(id),
    enabled: !!id,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });
};

/**
 * 가격 미리보기 조회
 */
export const useMasterPricePreview = (id: string) => {
  return useQuery({
    queryKey: productQueryKeys.masterPricePreview(id),
    queryFn: () => products.masters.getPricePreview(id),
    enabled: !!id,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });
};

// ===== 제품 변형 관련 쿼리 =====

/**
 * 마스터별 제품 변형 조회
 */
export const useVariantsByMaster = (query: VariantsQuery) => {
  return useQuery({
    queryKey: productQueryKeys.variantsByMaster(query.masterId, query),
    queryFn: () => products.variants.getByMaster(query.masterId, query),
    enabled: !!query.masterId,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });
};

/**
 * 제품 변형 상세 조회
 */
export const useVariant = (id: string) => {
  return useQuery({
    queryKey: productQueryKeys.variant(id),
    queryFn: () => products.variants.get(id),
    enabled: !!id,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });
};

/**
 * Variant 일괄 조회 (PIM batch endpoint)
 * 매칭 페이지 등에서 N+1 방지용
 */
export const useVariantsBatch = (ids: string[]) => {
  return useQuery({
    queryKey: productQueryKeys.variantsBatch(ids),
    queryFn: () => products.variants.getBatch(ids),
    enabled: ids.length > 0,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    select: (data: BatchVariantInfo[]) => {
      const map = new Map<string, BatchVariantInfo>();
      data.forEach((v) => map.set(v.id, v));
      return map;
    },
  });
};

/**
 * 제품 변형 가격 조회
 */
export const useVariantPrice = (id: string) => {
  return useQuery({
    queryKey: productQueryKeys.variantPrice(id),
    queryFn: () => products.variants.getPrice(id),
    enabled: !!id,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });
};

// ===== 판매 채널 관련 쿼리 =====

/**
 * 판매 채널 목록 조회
 */
export const useChannels = (query: ChannelsQuery = {}) => {
  return useQuery({
    queryKey: productQueryKeys.channelsList(query),
    queryFn: () => products.channels.getList(query),
    staleTime: 5 * 60 * 1000, // 5분
    gcTime: 10 * 60 * 1000, // 10분
  });
};

/**
 * 활성 판매 채널 조회
 */
export const useActiveChannels = () => {
  return useQuery({
    queryKey: productQueryKeys.activeChannels(),
    queryFn: () => products.channels.getActive(),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
};

/**
 * 판매 채널 상세 조회
 */
export const useChannel = (id: string) => {
  return useQuery({
    queryKey: productQueryKeys.channel(id),
    queryFn: () => products.channels.get(id),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
};

/**
 * 타입별 판매 채널 조회
 */
export const useChannelsByType = (type: string) => {
  return useQuery({
    queryKey: productQueryKeys.channelsByType(type),
    queryFn: () => products.channels.getByType(type),
    enabled: !!type,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
};

// ===== 채널별 제품 관련 쿼리 =====

/**
 * 마스터별 채널 제품 조회
 */
export const useChannelProductsByMaster = (masterId: string) => {
  return useQuery({
    queryKey: productQueryKeys.channelProductsByMaster(masterId),
    queryFn: () => products.channelProducts.getByMaster(masterId),
    enabled: !!masterId,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });
};

/**
 * 채널별 제품 조회
 */
export const useChannelProductsByChannel = (query: ChannelProductsQuery) => {
  return useQuery({
    queryKey: productQueryKeys.channelProductsByChannel(query.channelId, query),
    queryFn: () =>
      products.channelProducts.getByChannel(query.channelId, query),
    enabled: !!query.channelId,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });
};

/**
 * 채널 제품 상세 조회
 */
export const useChannelProduct = (id: string) => {
  return useQuery({
    queryKey: productQueryKeys.channelProduct(id),
    queryFn: () => products.channelProducts.get(id),
    enabled: !!id,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });
};

/**
 * 병합된 채널 제품 조회
 */
export const useMergedChannelProduct = (
  masterId: string,
  channelId: string
) => {
  return useQuery({
    queryKey: productQueryKeys.mergedChannelProduct(masterId, channelId),
    queryFn: () => products.channelProducts.getMerged(masterId, channelId),
    enabled: !!masterId && !!channelId,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });
};

// ===== 매칭 테이블 관련 쿼리 =====

/**
 * 매칭 테이블 데이터 조회 (커스텀)
 */
export const useMatchingTable = (query: Record<string, string> = {}) => {
  return useQuery({
    queryKey: productQueryKeys.matchingTableList(query),
    queryFn: async () => {
      // 실제로는 별도의 API 엔드포인트를 호출하거나
      // 여러 API를 조합해서 매칭 테이블 데이터를 구성
      const response = await fetch(
        '/api/matching-table?' + new URLSearchParams(query)
      );
      return response.json();
    },
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });
};

// ===== 기존 호환성 쿼리 (점진적 마이그레이션용) =====

/**
 * 기존 제품 목록 조회 (호환성)
 */
export const useProducts = (query: Record<string, string> = {}) => {
  return useQuery({
    queryKey: [...productQueryKeys.products, query],
    queryFn: async () => {
      // 기존 API 호출 로직
      const response = await fetch(
        '/api/products?' + new URLSearchParams(query)
      );
      return response.json();
    },
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });
};

/**
 * 기존 제품 상세 조회 (호환성)
 */
export const useProduct = (id: string) => {
  return useQuery({
    queryKey: productQueryKeys.product(id),
    queryFn: async () => {
      const response = await fetch(`/api/products/${id}`);
      return response.json();
    },
    enabled: !!id,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });
};

/**
 * 기존 제품 변형 조회 (호환성)
 */
export const useProductVariants = (productId: string) => {
  return useQuery({
    queryKey: productQueryKeys.productVariants(productId),
    queryFn: async () => {
      const response = await fetch(`/api/products/${productId}/variants`);
      return response.json();
    },
    enabled: !!productId,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });
};

// ===== 이름 변경 대응 별칭 (구 코드 호환성) =====

/**
 * 제품 마스터 목록 조회 (useChannelList → useChannels로 이름 변경됨)
 * @deprecated useChannels 사용 권장
 */
export const useChannelList = useChannels;

/**
 * 제품 마스터 목록 조회 (useMasterList → useMasters로 이름 변경됨)
 * @deprecated useMasters 사용 권장
 */
export const useMasterList = () => useMasters();

// ===== 판매처 타입 정의 목록 =====

export interface SalesChannelSite {
  id: string;
  type: string;
  name: string;
  isActive: boolean;
}

const SALES_CHANNEL_SITES: SalesChannelSite[] = [
  { id: 'medusa', type: 'medusa', name: '아몬드영 (자사몰)', isActive: true },
  {
    id: 'naver_smartstore',
    type: 'naver_smartstore',
    name: '네이버 스마트스토어',
    isActive: true,
  },
  { id: 'coupang', type: 'coupang', name: '쿠팡', isActive: true },
  { id: 'phone_order', type: 'phone_order', name: '전화주문', isActive: true },
  { id: 'other', type: 'other', name: '기타', isActive: true },
];

/**
 * 지원하는 판매처 타입 목록 반환
 * type이 'all'이면 전체, 특정 type이면 해당 타입만 반환
 */
export const useSalesChannelSites = (type: string = 'all') => {
  return useQuery({
    queryKey: ['sales-channel-sites', type],
    queryFn: () => {
      if (type === 'all') return SALES_CHANNEL_SITES;
      return SALES_CHANNEL_SITES.filter((s) => s.type === type);
    },
    staleTime: Infinity,
    gcTime: Infinity,
  });
};

// ===== 배너 그룹 관련 쿼리 =====

export const useBannerGroups = (query?: { category?: string }) => {
  return useQuery({
    queryKey: productQueryKeys.bannerGroupsList(query ?? {}),
    queryFn: () => products.bannerGroups.list(query),
    staleTime: 2 * 60 * 1000,
  });
};

export const useBannerGroup = (id: string) => {
  return useQuery({
    queryKey: productQueryKeys.bannerGroup(id),
    queryFn: () => products.bannerGroups.get(id),
    enabled: !!id,
    staleTime: 2 * 60 * 1000,
  });
};

export const useBannersByGroup = (groupId: string, includeInactive = true) => {
  return useQuery({
    queryKey: productQueryKeys.bannersByGroup(groupId),
    queryFn: () => products.banners.listByGroup(groupId, includeInactive),
    enabled: !!groupId,
    staleTime: 2 * 60 * 1000,
  });
};

// ===== 태그 관련 쿼리 =====

export const useTagGroups = (query?: { isActive?: boolean }) => {
  return useQuery({
    queryKey: productQueryKeys.tagGroupsList(query ?? {}),
    queryFn: () => products.tags.listGroups(query),
    staleTime: 2 * 60 * 1000,
  });
};

export const useTagGroup = (id: string) => {
  return useQuery({
    queryKey: productQueryKeys.tagGroup(id),
    queryFn: () => products.tags.getGroup(id),
    enabled: !!id,
    staleTime: 2 * 60 * 1000,
  });
};

// ===== 버전 관련 쿼리 =====

export const useMasterVersions = (masterId: string) => {
  return useQuery({
    queryKey: productQueryKeys.masterVersions(masterId),
    queryFn: () => products.versions.listByMaster(masterId),
    enabled: !!masterId,
    staleTime: 30 * 1000,
  });
};

// ===== 가격 관리 관련 쿼리 =====

export const useVersionPricingRules = (versionId: string) => {
  return useQuery({
    queryKey: productQueryKeys.pricingVersionRules(versionId),
    queryFn: () => products.pricing.versions.getRules(versionId),
    enabled: !!versionId,
    staleTime: 30 * 1000,
  });
};

export const useMasterPricingRules = (masterId: string) => {
  return useQuery({
    queryKey: productQueryKeys.pricingMasterRules(masterId),
    queryFn: () => products.pricing.masters.getRules(masterId),
    enabled: !!masterId,
    staleTime: 30 * 1000,
    retry: (count, error: any) => {
      if (error?.response?.status === 404) return false;
      return count < 2;
    },
  });
};

export const useVersionVariantPriceSet = (versionId: string, variantId: string) => {
  return useQuery({
    queryKey: productQueryKeys.pricingVersionPriceSet(versionId, variantId),
    queryFn: () => products.pricing.versions.getPriceSet(versionId, variantId),
    enabled: !!versionId && !!variantId,
    staleTime: 30 * 1000,
  });
};

export const useMasterVariantPriceSet = (masterId: string, variantId: string) => {
  return useQuery({
    queryKey: productQueryKeys.pricingMasterPriceSet(masterId, variantId),
    queryFn: () => products.pricing.masters.getPriceSet(masterId, variantId),
    enabled: !!masterId && !!variantId,
    staleTime: 30 * 1000,
  });
};
