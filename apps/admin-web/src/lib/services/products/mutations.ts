// src/lib/services/products/mutations.ts
// PIM API 뮤테이션 훅

'use client';

import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { productQueryKeys } from './query-keys';
import { products } from '@/lib/api/domains';
import { channelListingsClient } from '@/lib/api/domains/products/channel-listings.client';
import { channelCategoriesClient } from '@/lib/api/domains/products/channel-categories.client';
import type {
  CreateCategoryDto,
  UpdateCategoryDto,
  MoveCategoryDto,
  UpdateMasterDto,
  UpdatePricingStrategyDto,
  CreateChannelProductDto,
  UpdateChannelProductDto,
  UpdateChannelProductNameDto,
  UpdateChannelProductStatusDto,
  CreateBannerGroupDto,
  UpdateBannerGroupDto,
  CreateBannerDto,
  UpdateBannerDto,
  CreateNoticeDto,
  UpdateNoticeDto,
  CreateTagGroupDto,
  UpdateTagGroupDto,
  CreateTagValueDto,
  UpdateTagValueDto,
  ReplacePricingRulesDto,
  CalculatePriceRequestDto,
  CreateDraftVersionDto,
  CreateChannelListingDto,
  UpdateChannelListingDto,
  CreateChannelCategoryDto,
  UpdateChannelCategoryDto,
  BulkUpdateDto,
  BulkDeleteDto,
  BulkRestoreDto,
} from '@/lib/types/dto/products';
import type {
  BulkUpdateProductVariantDto,
  UpdateMasterVersionDto,
  UpdateProductVariantDto,
} from './products-detail.types';

// ===== 카테고리 관련 뮤테이션 =====

/**
 * 카테고리 생성
 */
export const useCreateCategory = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateCategoryDto) => products.categories.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.categories,
      });
    },
  });
};

/**
 * 카테고리 수정
 */
export const useUpdateCategory = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateCategoryDto }) =>
      products.categories.update(id, data),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.categories,
      });
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.category(variables.id),
      });
    },
  });
};

/**
 * 카테고리 삭제
 */
export const useDeleteCategory = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      moveProductsTo,
    }: {
      id: string;
      moveProductsTo?: string;
    }) => products.categories.delete(id, moveProductsTo),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.categories,
      });
    },
  });
};

/**
 * 카테고리 이동
 */
export const useMoveCategory = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, newParentId }: { id: string; newParentId?: string }) =>
      products.categories.move(id, newParentId),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.categories,
      });
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.category(variables.id),
      });
    },
  });
};

/**
 * 카테고리 순서 변경 (동일 부모 내)
 * 부모 변경은 useMoveCategory 호출 후 이 훅으로 새 부모의 형제 순서를 잡는다.
 */
export const useReorderCategories = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      parentId,
      categoryIds,
    }: {
      parentId: string | null;
      categoryIds: string[];
    }) => products.categories.reorder(parentId, categoryIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productQueryKeys.categories });
    },
  });
};

// ===== 제품 마스터 관련 뮤테이션 =====

/**
 * 제품 마스터 생성
 */
export const useCreateMaster = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => products.masters.create(),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.masters,
      });
    },
  });
};

/**
 * 제품 마스터 수정
 */
export const useUpdateMaster = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateMasterDto }) =>
      products.masters.update(id, data),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.masters,
      });
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.master(variables.id),
      });
    },
  });
};

/**
 * 제품 마스터 삭제
 */
export const useDeleteMaster = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => products.masters.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.masters,
      });
    },
  });
};

/**
 * 가격 전략 변경
 */
export const useUpdatePricingStrategy = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: UpdatePricingStrategyDto;
    }) => products.masters.updatePricingStrategy(id, data),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.masters,
      });
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.master(variables.id),
      });
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.masterPricePreview(variables.id),
      });
    },
  });
};

// ===== 채널별 제품 관련 뮤테이션 =====

/**
 * 채널별 제품 생성
 */
export const useCreateChannelProduct = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateChannelProductDto) =>
      products.channelProducts.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.channelProducts,
      });
    },
  });
};

/**
 * 채널별 제품 수정
 */
export const useUpdateChannelProduct = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateChannelProductDto }) =>
      products.channelProducts.update(id, data),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.channelProducts,
      });
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.channelProduct(variables.id),
      });
    },
  });
};

/**
 * 채널별 제품 삭제
 */
export const useDeleteChannelProduct = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => products.channelProducts.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.channelProducts,
      });
    },
  });
};

/**
 * 제품명 덮어쓰기
 */
export const useUpdateChannelProductName = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: UpdateChannelProductNameDto;
    }) => products.channelProducts.updateName(id, data),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.channelProducts,
      });
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.channelProduct(variables.id),
      });
    },
  });
};

/**
 * 채널별 제품 상태 설정
 */
export const useUpdateChannelProductStatus = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: UpdateChannelProductStatusDto;
    }) => products.channelProducts.updateStatus(id, data),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.channelProducts,
      });
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.channelProduct(variables.id),
      });
    },
  });
};

// ===== 배너 그룹 뮤테이션 =====

export const useCreateBannerGroup = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateBannerGroupDto) => products.bannerGroups.create(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productQueryKeys.bannerGroups });
    },
  });
};

export const useUpdateBannerGroup = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateBannerGroupDto }) =>
      products.bannerGroups.update(id, dto),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: productQueryKeys.bannerGroups });
      queryClient.invalidateQueries({ queryKey: productQueryKeys.bannerGroup(variables.id) });
    },
  });
};

export const useDeleteBannerGroup = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, deletedBy }: { id: string; deletedBy?: string }) =>
      products.bannerGroups.remove(id, deletedBy),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productQueryKeys.bannerGroups });
    },
  });
};

// ===== 배너 뮤테이션 =====

export const useCreateBanner = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateBannerDto) => products.banners.create(dto),
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.bannersByGroup(data.bannerGroupId),
      });
    },
  });
};

export const useUpdateBanner = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateBannerDto }) =>
      products.banners.update(id, dto),
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.bannersByGroup(data.bannerGroupId),
      });
    },
  });
};

export const useDeleteBanner = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, groupId, deletedBy }: { id: string; groupId: string; deletedBy?: string }) =>
      products.banners.remove(id, deletedBy).then((res) => ({ ...res, groupId })),
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.bannersByGroup(data.groupId),
      });
    },
  });
};

// ===== 태그 그룹 뮤테이션 =====

export const useCreateTagGroup = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateTagGroupDto) => products.tags.createGroup(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productQueryKeys.tagGroups });
    },
  });
};

export const useUpdateTagGroup = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateTagGroupDto }) =>
      products.tags.updateGroup(id, dto),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: productQueryKeys.tagGroups });
      queryClient.invalidateQueries({ queryKey: productQueryKeys.tagGroup(variables.id) });
    },
  });
};

export const useDeleteTagGroup = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => products.tags.removeGroup(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productQueryKeys.tagGroups });
    },
  });
};

// ===== 태그 값 뮤테이션 =====

export const useCreateTagValue = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, dto }: { groupId: string; dto: CreateTagValueDto }) =>
      products.tags.createValue(groupId, dto),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: productQueryKeys.tagGroups });
      queryClient.invalidateQueries({ queryKey: productQueryKeys.tagValues(data.groupId) });
    },
  });
};

export const useUpdateTagValue = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, groupId, dto }: { id: string; groupId: string; dto: UpdateTagValueDto }) =>
      products.tags.updateValue(id, dto).then((res) => ({ ...res, groupId })),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: productQueryKeys.tagValues(data.groupId) });
    },
  });
};

export const useDeleteTagValue = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, groupId }: { id: string; groupId: string }) =>
      products.tags.removeValue(id).then(() => ({ groupId })),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: productQueryKeys.tagGroups });
      queryClient.invalidateQueries({ queryKey: productQueryKeys.tagValues(data.groupId) });
    },
  });
};

// ===== 버전 관련 뮤테이션 =====

function invalidateProductVariantEditingQueries(
  queryClient: QueryClient,
  masterId: string,
  versionId: string
) {
  queryClient.invalidateQueries({
    queryKey: productQueryKeys.versionDetail(masterId, versionId),
  });
  queryClient.invalidateQueries({
    queryKey: productQueryKeys.master(masterId),
  });
  queryClient.invalidateQueries({
    queryKey: productQueryKeys.masterVersions(masterId),
  });
  queryClient.invalidateQueries({
    queryKey: productQueryKeys.variants,
  });
  queryClient.invalidateQueries({
    queryKey: productQueryKeys.pricingVersion(versionId),
  });
}

function invalidateProductVersionLifecycleQueries(
  queryClient: QueryClient,
  masterId: string,
  versionId: string
) {
  queryClient.invalidateQueries({
    queryKey: productQueryKeys.masters,
  });
  queryClient.invalidateQueries({
    queryKey: productQueryKeys.master(masterId),
  });
  queryClient.invalidateQueries({
    queryKey: productQueryKeys.masterVersions(masterId),
  });
  queryClient.invalidateQueries({
    queryKey: productQueryKeys.versionDetail(masterId, versionId),
  });
  queryClient.invalidateQueries({
    queryKey: productQueryKeys.variants,
  });
  queryClient.invalidateQueries({
    queryKey: ['pricing'],
  });
}

export const useCreateMasterDraftVersion = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ masterId, dto }: { masterId: string; dto: CreateDraftVersionDto }) =>
      products.versions.createDraft(masterId, dto),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.masterVersions(variables.masterId),
      });
    },
  });
};

export const useUpdateMasterVersion = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      masterId,
      versionId,
      dto,
    }: {
      masterId: string;
      versionId: string;
      dto: UpdateMasterVersionDto;
    }) => products.versions.update(masterId, versionId, dto),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.versionDetail(variables.masterId, variables.versionId),
      });
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.master(variables.masterId),
      });
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.masterVersions(variables.masterId),
      });
      if (variables.dto.optionDiff) {
        queryClient.invalidateQueries({
          queryKey: productQueryKeys.variants,
        });
      }
    },
  });
};

export const usePublishProductVersion = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      masterId,
      versionId,
    }: {
      masterId: string;
      versionId: string;
    }) => products.versions.publish(masterId, versionId),
    onSuccess: (_, variables) => {
      invalidateProductVersionLifecycleQueries(
        queryClient,
        variables.masterId,
        variables.versionId
      );
    },
  });
};

export const useDeleteDraftProductVersion = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      masterId,
      versionId,
    }: {
      masterId: string;
      versionId: string;
    }) => products.versions.deleteDraft(masterId, versionId),
    onSuccess: (_, variables) => {
      invalidateProductVersionLifecycleQueries(
        queryClient,
        variables.masterId,
        variables.versionId
      );
    },
  });
};

export const useUpdateDraftVariant = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      masterId,
      versionId,
      variantId,
      dto,
    }: {
      masterId: string;
      versionId: string;
      variantId: string;
      dto: UpdateProductVariantDto;
    }) => products.versions.updateVariant(masterId, versionId, variantId, dto),
    onSuccess: (_, variables) => {
      invalidateProductVariantEditingQueries(
        queryClient,
        variables.masterId,
        variables.versionId
      );
    },
  });
};

export const useBulkUpdateDraftVariants = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      masterId,
      versionId,
      dto,
    }: {
      masterId: string;
      versionId: string;
      dto: BulkUpdateProductVariantDto;
    }) => products.versions.bulkUpdateVariants(masterId, versionId, dto),
    onSuccess: (_, variables) => {
      invalidateProductVariantEditingQueries(
        queryClient,
        variables.masterId,
        variables.versionId
      );
    },
  });
};

// ===== 가격 관리 뮤테이션 =====

// rules 뿐 아니라 variant 별 price-set 쿼리(옵션별 가격 현황)와
// versionDetail(variants 테이블의 가격 컬럼)까지 함께 무효화
function invalidatePricingRulesQueries(
  queryClient: QueryClient,
  masterId: string,
  versionId: string
) {
  queryClient.invalidateQueries({
    queryKey: productQueryKeys.pricingVersion(versionId),
  });
  queryClient.invalidateQueries({
    queryKey: productQueryKeys.versionDetail(masterId, versionId),
  });
}

export const useReplaceVersionPricingRules = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      versionId,
      dto,
    }: {
      masterId: string;
      versionId: string;
      dto: ReplacePricingRulesDto;
    }) => products.pricing.versions.replaceRules(versionId, dto),
    onSuccess: (_, variables) => {
      invalidatePricingRulesQueries(
        queryClient,
        variables.masterId,
        variables.versionId
      );
    },
  });
};

export const useDeleteVersionPricingRules = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ versionId }: { masterId: string; versionId: string }) =>
      products.pricing.versions.deleteRules(versionId),
    onSuccess: (_, variables) => {
      invalidatePricingRulesQueries(
        queryClient,
        variables.masterId,
        variables.versionId
      );
    },
  });
};

export const useCalculateVersionPrice = () => {
  return useMutation({
    mutationFn: ({ versionId, dto }: { versionId: string; dto: CalculatePriceRequestDto }) =>
      products.pricing.versions.calculate(versionId, dto),
  });
};

export const useCalculateMasterPrice = () => {
  return useMutation({
    mutationFn: ({ masterId, dto }: { masterId: string; dto: CalculatePriceRequestDto }) =>
      products.pricing.masters.calculate(masterId, dto),
  });
};

// ===== 채널 리스팅 =====

export const useCreateChannelListing = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateChannelListingDto) =>
      channelListingsClient.createChannelListing(data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.channelListingsByVariant(variables.variantId),
      });
    },
  });
};

export const useUpdateChannelListing = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateChannelListingDto }) =>
      channelListingsClient.updateChannelListing(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: productQueryKeys.channelListing(id) });
      queryClient.invalidateQueries({ queryKey: ['channel-listings'] });
    },
  });
};

export const useActivateChannelListing = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => channelListingsClient.activateChannelListing(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['channel-listings'] });
    },
  });
};

export const useDeactivateChannelListing = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => channelListingsClient.deactivateChannelListing(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['channel-listings'] });
    },
  });
};

export const useDeleteChannelListing = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => channelListingsClient.deleteChannelListing(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['channel-listings'] });
    },
  });
};

// ===== 채널 카테고리 =====

export const useCreateChannelCategory = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateChannelCategoryDto) =>
      channelCategoriesClient.createChannelCategory(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productQueryKeys.channelCategories });
    },
  });
};

export const useUpdateChannelCategory = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateChannelCategoryDto }) =>
      channelCategoriesClient.updateChannelCategory(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: productQueryKeys.channelCategories });
      queryClient.invalidateQueries({ queryKey: productQueryKeys.channelCategory(id) });
    },
  });
};

export const useDeleteChannelCategory = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => channelCategoriesClient.deleteChannelCategory(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productQueryKeys.channelCategories });
    },
  });
};

// ===== 일괄 작업 =====

export const useBulkUpdateMasters = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: BulkUpdateDto) => products.bulk.update(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productQueryKeys.masters });
    },
  });
};

export const useBulkDeleteMasters = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: BulkDeleteDto) => products.bulk.delete(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productQueryKeys.masters });
    },
  });
};

export const useBulkRestoreMasters = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: BulkRestoreDto) => products.bulk.restore(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productQueryKeys.masters });
    },
  });
};

// ===== CSV =====

export const useCsvBulkImport = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ file, userId }: { file: File; userId: string }) =>
      products.csv.bulkImport(file, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productQueryKeys.masters });
    },
  });
};

// ===== 승인 =====

export const useSubmitApproval = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (masterId: string) => products.approval.submitApproval(masterId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productQueryKeys.pendingApprovals });
      queryClient.invalidateQueries({ queryKey: productQueryKeys.masters });
    },
  });
};

export const useApprove = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ masterId, comment }: { masterId: string; comment?: string }) =>
      products.approval.approve(masterId, comment),
    onSuccess: (_, { masterId }) => {
      queryClient.invalidateQueries({ queryKey: productQueryKeys.pendingApprovals });
      queryClient.invalidateQueries({ queryKey: productQueryKeys.master(masterId) });
      queryClient.invalidateQueries({ queryKey: productQueryKeys.approvalHistory(masterId) });
    },
  });
};

export const useReject = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ masterId, reason }: { masterId: string; reason: string }) =>
      products.approval.reject(masterId, reason),
    onSuccess: (_, { masterId }) => {
      queryClient.invalidateQueries({ queryKey: productQueryKeys.pendingApprovals });
      queryClient.invalidateQueries({ queryKey: productQueryKeys.master(masterId) });
      queryClient.invalidateQueries({ queryKey: productQueryKeys.approvalHistory(masterId) });
    },
  });
};

// ===== 공지사항 뮤테이션 =====

export const useCreateNotice = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateNoticeDto) => products.notices.create(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productQueryKeys.notices });
    },
  });
};

export const useUpdateNotice = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateNoticeDto }) =>
      products.notices.update(id, dto),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: productQueryKeys.notices });
      queryClient.invalidateQueries({ queryKey: productQueryKeys.notice(variables.id) });
    },
  });
};

export const useDeleteNotice = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, deletedBy }: { id: string; deletedBy?: string }) =>
      products.notices.remove(id, deletedBy),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productQueryKeys.notices });
    },
  });
};
