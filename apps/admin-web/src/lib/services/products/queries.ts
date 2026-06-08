// src/lib/services/products/queries.ts
// PIM API 쿼리 훅

'use client';

import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { productQueryKeys } from './query-keys';
import { products } from '@/lib/api/domains';
import { channelListingsClient } from '@/lib/api/domains/products/channel-listings.client';
import { channelCategoriesClient } from '@/lib/api/domains/products/channel-categories.client';
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
  ActiveChannelsResponseDto,
  ChannelProductDto,
  ChannelProductsQuery,
  ChannelProductsResponseDto,
  MasterChannelProductsResponseDto,
  MergedChannelProductDto,
  NoticeListQuery,
} from '@/lib/types/dto/products';
import type { BatchVariantInfo } from '@/lib/api/domains/products/variants.client';
import type {
  MasterVersionDetailDto,
  ProductMasterDetail,
  ProductVariantsResponse,
} from './products-detail.types';

// ===== 카테고리 관련 쿼리 =====

/**
 * 카테고리 트리 조회
 * - includeInactive: 어드민 트리에서 비활성 카테고리까지 노출하려면 true.
 */
export const useCategoryTree = (options?: {
  maxDepth?: number;
  includeInactive?: boolean;
}) => {
  return useQuery({
    queryKey: productQueryKeys.categoryTree(options),
    queryFn: () => products.categories.getTree(options),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
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
 * 제품 마스터 목록 요약 조회
 * 백엔드 `GET /masters` 가 실제로 반환하는 ProductSummaryDto 모양에 맞춰진 훅.
 */
export const useMastersSummary = (query: MastersQuery = {}) => {
  return useQuery({
    queryKey: productQueryKeys.mastersSummaryList(query),
    queryFn: () => products.masters.getListSummary(query),
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
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
 * 제품 마스터 상세 조회 (Suspense).
 * products-detail 페이지 전용. 글로벌 MasterDto 가 백엔드 응답과 어긋나있어
 * 로컬 ProductMasterDetail 타입으로 받는다. 정합 정비는 별도 PR.
 */
export const useMasterSuspense = (id: string) => {
  return useSuspenseQuery({
    queryKey: productQueryKeys.master(id),
    queryFn: async () =>
      (await products.masters.get(id)) as unknown as ProductMasterDetail,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });
};

/**
 * 제품 마스터 ID 목록으로 배치 조회 (썸네일/이름 lookup용)
 */
export const useMastersByIds = (ids: string[]) => {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  return useQuery({
    queryKey: productQueryKeys.mastersBatch(uniqueIds),
    queryFn: () => products.masters.listByIds(uniqueIds),
    enabled: uniqueIds.length > 0,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });
};

/**
 * 제품 마스터 배치 조회
 */
export const useMastersByIdsSuspense = (ids: string[]) => {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  return useSuspenseQuery({
    queryKey: productQueryKeys.mastersBatch(uniqueIds),
    queryFn: () => products.masters.listByIds(uniqueIds),
    staleTime: 60 * 1000,
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
 * 마스터별 제품 변형 조회 (Suspense).
 * products-detail 페이지 전용. 글로벌 VariantDto 가 백엔드 응답과 어긋나있어
 * 로컬 ProductVariantsResponse 타입으로 받는다. 정합 정비는 별도 PR.
 */
export const useVariantsByMasterSuspense = (
  masterId: string,
  limit = 100,
) => {
  const query = { masterId, page: 1, limit };
  return useSuspenseQuery({
    queryKey: productQueryKeys.variantsByMaster(masterId, query),
    queryFn: async () =>
      (await products.variants.getByMaster(
        masterId,
        query,
      )) as unknown as ProductVariantsResponse,
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

// ===== 활성 판매 채널 조회 (order/input 등에서 사용) =====

export const useActiveChannels = () => {
  return useQuery({
    queryKey: productQueryKeys.activeChannels(),
    queryFn: () => products.channels.getActive(),
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

// ===== 이름 변경 대응 별칭 (구 코드 호환성) =====

/**
 * 제품 마스터 목록 조회 (useMasterList → useMasters로 이름 변경됨)
 * @deprecated useMasters 사용 권장
 */
export const useMasterList = () => useMasters();

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

/**
 * 버전 트리 조회 (Suspense). 버전 트리 페이지 전용.
 * 백엔드가 parent→children 재귀 트리로 응답한다.
 */
export const useVersionTreeSuspense = (masterId: string) => {
  return useSuspenseQuery({
    queryKey: productQueryKeys.masterVersions(masterId),
    queryFn: () => products.versions.listByMaster(masterId),
    staleTime: 30 * 1000,
  });
};

/**
 * 특정 버전 상세 조회 (Suspense). products-detail 페이지가 ?versionId 로 진입했을 때 사용.
 * MasterDto/VersionDetailDto 정합 정비 전까지는 로컬 타입으로 받는다.
 */
export const useVersionDetailSuspense = (masterId: string, versionId: string) => {
  return useSuspenseQuery({
    queryKey: productQueryKeys.versionDetailRaw(masterId, versionId),
    queryFn: () => products.versions.getById(masterId, versionId),
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });
};

export const useVersionDetail = (masterId: string, versionId: string | null) => {
  return useQuery<MasterVersionDetailDto>({
    queryKey: versionId
      ? productQueryKeys.versionDetailRaw(masterId, versionId)
      : [...productQueryKeys.masterVersions(masterId), 'detail', 'none'],
    queryFn: () => {
      if (!versionId) {
        throw new Error('versionId is required');
      }
      return products.versions.getById(masterId, versionId);
    },
    enabled: !!masterId && !!versionId,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
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

export const useVersionVariantPriceSet = (
  versionId: string,
  variantId: string
) => {
  return useQuery({
    queryKey: productQueryKeys.pricingVersionPriceSet(versionId, variantId),
    queryFn: () => products.pricing.versions.getPriceSet(versionId, variantId),
    enabled: !!versionId && !!variantId,
    staleTime: 30 * 1000,
  });
};

export const useMasterVariantPriceSet = (
  masterId: string,
  variantId: string
) => {
  return useQuery({
    queryKey: productQueryKeys.pricingMasterPriceSet(masterId, variantId),
    queryFn: () => products.pricing.masters.getPriceSet(masterId, variantId),
    enabled: !!masterId && !!variantId,
    staleTime: 30 * 1000,
  });
};

// ===== 채널 리스팅 =====

export const useChannelListingsByVariant = (variantId: string) => {
  return useQuery({
    queryKey: productQueryKeys.channelListingsByVariant(variantId),
    queryFn: () => channelListingsClient.getChannelListingsByVariant(variantId),
    enabled: !!variantId,
    staleTime: 30 * 1000,
  });
};

// ===== 채널 카테고리 =====

export const useChannelCategories = () => {
  return useQuery({
    queryKey: productQueryKeys.channelCategories,
    queryFn: () => channelCategoriesClient.listChannelCategories(),
    staleTime: 60 * 1000,
  });
};

// ===== 감사 로그 =====

export const useAuditRecent = (limit = 100) => {
  return useQuery({
    queryKey: productQueryKeys.auditRecent(limit),
    queryFn: () => products.audit.getRecent(limit),
    staleTime: 30 * 1000,
  });
};

export const useAuditByUser = (userId: string, limit = 100) => {
  return useQuery({
    queryKey: productQueryKeys.auditByUser(userId, limit),
    queryFn: () => products.audit.getByUser(userId, limit),
    enabled: !!userId,
    staleTime: 30 * 1000,
  });
};

export const useAuditByAction = (action: string, limit = 100) => {
  return useQuery({
    queryKey: productQueryKeys.auditByAction(action, limit),
    queryFn: () => products.audit.getByAction(action, limit),
    enabled: !!action,
    staleTime: 30 * 1000,
  });
};

export const useProductAuditHistory = (masterId: string) => {
  return useQuery({
    queryKey: productQueryKeys.auditProduct(masterId),
    queryFn: () => products.audit.getProductHistory(masterId),
    enabled: !!masterId,
    staleTime: 30 * 1000,
  });
};

// ===== 승인 =====

export const usePendingApprovals = () => {
  return useQuery({
    queryKey: productQueryKeys.pendingApprovals,
    queryFn: () => products.approval.getPending(),
    staleTime: 30 * 1000,
  });
};

export const useApprovalHistory = (masterId: string) => {
  return useQuery({
    queryKey: productQueryKeys.approvalHistory(masterId),
    queryFn: () => products.approval.getApprovalHistory(masterId),
    enabled: !!masterId,
    staleTime: 30 * 1000,
  });
};

// ===== 공지사항 관련 쿼리 =====

export const useNotices = (query?: NoticeListQuery) => {
  return useQuery({
    queryKey: productQueryKeys.noticesList(query ?? {}),
    queryFn: () => products.notices.list(query),
    staleTime: 2 * 60 * 1000,
  });
};

export const useNotice = (id: string) => {
  return useQuery({
    queryKey: productQueryKeys.notice(id),
    queryFn: () => products.notices.get(id),
    enabled: !!id,
    staleTime: 2 * 60 * 1000,
  });
};
