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
  CreateBannerGroupDto,
  UpdateBannerGroupDto,
  CreateBannerDto,
  UpdateBannerDto,
  CreateNoticeDto,
  AdminShopListingPayload,
  AlmondTemplateStatus,
  UpdateNoticeDto,
  CreateSitePopupDto,
  UpdateSitePopupDto,
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
  BulkUpdatePolicyDto,
  MastersQuery,
} from '@/lib/types/dto/products';
import type {
  BulkUpdateProductVariantDto,
  UpdateMasterVersionDto,
  UpdateProductVariantDto,
} from './products-detail.types';
import type { PermissionRequirement } from '@/lib/auth/mutation-permission';

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
useCreateCategory.permission = ['catalog.category.write'] as const satisfies PermissionRequirement;

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
useUpdateCategory.permission = ['catalog.category.write'] as const satisfies PermissionRequirement;

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
useDeleteCategory.permission = ['catalog.category.write'] as const satisfies PermissionRequirement;

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
useMoveCategory.permission = ['catalog.category.write'] as const satisfies PermissionRequirement;

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
useReorderCategories.permission = ['catalog.category.write'] as const satisfies PermissionRequirement;

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
useCreateMaster.permission = ['catalog.product.write'] as const satisfies PermissionRequirement;

/**
 * 멤버십가 공개 제한 변경 (draft 없이 즉시 적용)
 */
export const useUpdateMembershipPriceVisibility = (
  masterId: string,
  versionId: string | null
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (hideMembershipPriceForNonMembers: boolean) =>
      products.masters.updateMembershipPriceVisibility(
        masterId,
        hideMembershipPriceForNonMembers
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.master(masterId),
      });
      if (versionId) {
        queryClient.invalidateQueries({
          queryKey: productQueryKeys.versionDetail(masterId, versionId),
        });
      }
    },
  });
};
useUpdateMembershipPriceVisibility.permission = ['catalog.product.write'] as const satisfies PermissionRequirement;

/**
 * 멤버십 회원 전용 노출 변경 (draft 없이 즉시 적용)
 */
export const useUpdateMembersOnlyVisibility = (
  masterId: string,
  versionId: string | null
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (isVisibleToMembersOnly: boolean) =>
      products.masters.updateMembersOnlyVisibility(
        masterId,
        isVisibleToMembersOnly
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.master(masterId),
      });
      if (versionId) {
        queryClient.invalidateQueries({
          queryKey: productQueryKeys.versionDetail(masterId, versionId),
        });
      }
    },
  });
};
useUpdateMembersOnlyVisibility.permission = ['catalog.product.write'] as const satisfies PermissionRequirement;

/**
 * 해외직구 여부 변경 (draft 없이 즉시 적용)
 */
export const useUpdateOverseas = (
  masterId: string,
  versionId: string | null
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (isOverseas: boolean) =>
      products.masters.updateOverseas(masterId, isOverseas),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.master(masterId),
      });
      if (versionId) {
        queryClient.invalidateQueries({
          queryKey: productQueryKeys.versionDetail(masterId, versionId),
        });
      }
    },
  });
};
useUpdateOverseas.permission = ['catalog.product.write'] as const satisfies PermissionRequirement;

/**
 * 배송비 그룹 변경 (draft 없이 즉시 적용)
 */
export const useUpdateShippingGroup = (
  masterId: string,
  versionId: string | null
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (shippingGroupCode: string | null) =>
      products.masters.updateShippingGroup(masterId, shippingGroupCode),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.master(masterId),
      });
      if (versionId) {
        queryClient.invalidateQueries({
          queryKey: productQueryKeys.versionDetail(masterId, versionId),
        });
      }
    },
  });
};
useUpdateShippingGroup.permission = ['catalog.product.write'] as const satisfies PermissionRequirement;

export const useUpdateRequiresMembership = (
  masterId: string,
  versionId: string | null
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (requiresMembership: boolean) =>
      products.masters.updateRequiresMembership(masterId, requiresMembership),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.master(masterId),
      });
      if (versionId) {
        queryClient.invalidateQueries({
          queryKey: productQueryKeys.versionDetail(masterId, versionId),
        });
      }
    },
  });
};
useUpdateRequiresMembership.permission = ['catalog.product.write'] as const satisfies PermissionRequirement;

/**
 * @deprecated use useUpdateMembershipPriceVisibility
 */
export const useUpdateMembershipVisibility = useUpdateMembershipPriceVisibility;

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
useDeleteMaster.permission = ['catalog.product.delete'] as const satisfies PermissionRequirement;

// ===== 채널별 제품 관련 뮤테이션 =====

// ===== 배너 그룹 뮤테이션 =====

export const useCreateBannerGroup = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateBannerGroupDto) =>
      products.bannerGroups.create(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.bannerGroups,
      });
    },
  });
};
useCreateBannerGroup.permission = ['marketing.display.write'] as const satisfies PermissionRequirement;

export const useUpdateBannerGroup = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateBannerGroupDto }) =>
      products.bannerGroups.update(id, dto),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.bannerGroups,
      });
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.bannerGroup(variables.id),
      });
    },
  });
};
useUpdateBannerGroup.permission = ['marketing.display.write'] as const satisfies PermissionRequirement;

export const useDeleteBannerGroup = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) => products.bannerGroups.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.bannerGroups,
      });
    },
  });
};
useDeleteBannerGroup.permission = ['marketing.display.write'] as const satisfies PermissionRequirement;

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
useCreateBanner.permission = ['marketing.display.write'] as const satisfies PermissionRequirement;

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
useUpdateBanner.permission = ['marketing.display.write'] as const satisfies PermissionRequirement;

export const useDeleteBanner = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      groupId,
      deletedBy,
    }: {
      id: string;
      groupId: string;
      deletedBy?: string;
    }) =>
      products.banners
        .remove(id, deletedBy)
        .then((res) => ({ ...res, groupId })),
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.bannersByGroup(data.groupId),
      });
    },
  });
};
useDeleteBanner.permission = ['marketing.display.write'] as const satisfies PermissionRequirement;

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
useCreateTagGroup.permission = ['catalog.category.write'] as const satisfies PermissionRequirement;

export const useUpdateTagGroup = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateTagGroupDto }) =>
      products.tags.updateGroup(id, dto),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: productQueryKeys.tagGroups });
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.tagGroup(variables.id),
      });
    },
  });
};
useUpdateTagGroup.permission = ['catalog.category.write'] as const satisfies PermissionRequirement;

export const useDeleteTagGroup = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => products.tags.removeGroup(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productQueryKeys.tagGroups });
    },
  });
};
useDeleteTagGroup.permission = ['catalog.category.write'] as const satisfies PermissionRequirement;

// ===== 태그 값 뮤테이션 =====

export const useCreateTagValue = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      groupId,
      dto,
    }: {
      groupId: string;
      dto: CreateTagValueDto;
    }) => products.tags.createValue(groupId, dto),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: productQueryKeys.tagGroups });
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.tagValues(data.groupId),
      });
    },
  });
};
useCreateTagValue.permission = ['catalog.category.write'] as const satisfies PermissionRequirement;

export const useUpdateTagValue = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      groupId,
      dto,
    }: {
      id: string;
      groupId: string;
      dto: UpdateTagValueDto;
    }) =>
      products.tags.updateValue(id, dto).then((res) => ({ ...res, groupId })),
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.tagValues(data.groupId),
      });
    },
  });
};
useUpdateTagValue.permission = ['catalog.category.write'] as const satisfies PermissionRequirement;

export const useDeleteTagValue = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, groupId }: { id: string; groupId: string }) =>
      products.tags.removeValue(id).then(() => ({ groupId })),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: productQueryKeys.tagGroups });
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.tagValues(data.groupId),
      });
    },
  });
};
useDeleteTagValue.permission = ['catalog.category.write'] as const satisfies PermissionRequirement;

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
    mutationFn: ({
      masterId,
      dto,
    }: {
      masterId: string;
      dto: CreateDraftVersionDto;
    }) => products.versions.createDraft(masterId, dto),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.masterVersions(variables.masterId),
      });
    },
  });
};
useCreateMasterDraftVersion.permission = ['catalog.product.write'] as const satisfies PermissionRequirement;

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
        queryKey: productQueryKeys.versionDetail(
          variables.masterId,
          variables.versionId
        ),
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
useUpdateMasterVersion.permission = ['catalog.product.write'] as const satisfies PermissionRequirement;

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
usePublishProductVersion.permission = ['catalog.product.write'] as const satisfies PermissionRequirement;

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
useDeleteDraftProductVersion.permission = ['catalog.product.write'] as const satisfies PermissionRequirement;

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
useUpdateDraftVariant.permission = ['catalog.product.write'] as const satisfies PermissionRequirement;

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
useBulkUpdateDraftVariants.permission = ['catalog.product.write'] as const satisfies PermissionRequirement;

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
useReplaceVersionPricingRules.permission = ['catalog.price.write'] as const satisfies PermissionRequirement;

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
useDeleteVersionPricingRules.permission = ['catalog.price.write'] as const satisfies PermissionRequirement;

export const useCalculateVersionPrice = () => {
  return useMutation({
    mutationFn: ({
      versionId,
      dto,
    }: {
      versionId: string;
      dto: CalculatePriceRequestDto;
    }) => products.pricing.versions.calculate(versionId, dto),
  });
};
useCalculateVersionPrice.permission = ['catalog.product.read'] as const satisfies PermissionRequirement;

export const useCalculateMasterPrice = () => {
  return useMutation({
    mutationFn: ({
      masterId,
      dto,
    }: {
      masterId: string;
      dto: CalculatePriceRequestDto;
    }) => products.pricing.masters.calculate(masterId, dto),
  });
};
useCalculateMasterPrice.permission = ['catalog.product.read'] as const satisfies PermissionRequirement;

// ===== 채널 리스팅 =====

export const useCreateChannelListing = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateChannelListingDto) =>
      channelListingsClient.createChannelListing(data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.channelListingsByVariant(
          variables.variantId
        ),
      });
    },
  });
};
useCreateChannelListing.permission = ['catalog.channel_listing.write'] as const satisfies PermissionRequirement;

export const useUpdateChannelListing = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateChannelListingDto }) =>
      channelListingsClient.updateChannelListing(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.channelListing(id),
      });
      queryClient.invalidateQueries({ queryKey: ['channel-listings'] });
    },
  });
};
useUpdateChannelListing.permission = ['catalog.channel_listing.write'] as const satisfies PermissionRequirement;

export const useActivateChannelListing = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      channelListingsClient.activateChannelListing(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['channel-listings'] });
    },
  });
};
useActivateChannelListing.permission = ['catalog.channel_listing.write'] as const satisfies PermissionRequirement;

export const useDeactivateChannelListing = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      channelListingsClient.deactivateChannelListing(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['channel-listings'] });
    },
  });
};
useDeactivateChannelListing.permission = ['catalog.channel_listing.write'] as const satisfies PermissionRequirement;

export const useDeleteChannelListing = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => channelListingsClient.deleteChannelListing(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['channel-listings'] });
    },
  });
};
useDeleteChannelListing.permission = ['catalog.channel_listing.write'] as const satisfies PermissionRequirement;

// ===== 채널 카테고리 =====

export const useCreateChannelCategory = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateChannelCategoryDto) =>
      channelCategoriesClient.createChannelCategory(data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.channelCategories,
      });
    },
  });
};
useCreateChannelCategory.permission = ['catalog.channel_listing.write'] as const satisfies PermissionRequirement;

export const useUpdateChannelCategory = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: UpdateChannelCategoryDto;
    }) => channelCategoriesClient.updateChannelCategory(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.channelCategories,
      });
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.channelCategory(id),
      });
    },
  });
};
useUpdateChannelCategory.permission = ['catalog.channel_listing.write'] as const satisfies PermissionRequirement;

export const useDeleteChannelCategory = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      channelCategoriesClient.deleteChannelCategory(id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.channelCategories,
      });
    },
  });
};
useDeleteChannelCategory.permission = ['catalog.channel_listing.write'] as const satisfies PermissionRequirement;

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
useBulkUpdateMasters.permission = ['catalog.bulk.execute'] as const satisfies PermissionRequirement;

export const useBulkDeleteMasters = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: BulkDeleteDto) => products.bulk.delete(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productQueryKeys.masters });
    },
  });
};
useBulkDeleteMasters.permission = ['catalog.bulk.execute'] as const satisfies PermissionRequirement;

export const useBulkRestoreMasters = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: BulkRestoreDto) => products.bulk.restore(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productQueryKeys.masters });
    },
  });
};
useBulkRestoreMasters.permission = ['catalog.bulk.execute'] as const satisfies PermissionRequirement;

export const useBulkUpdatePolicy = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: BulkUpdatePolicyDto) => products.bulk.policy(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productQueryKeys.masters });
    },
  });
};
useBulkUpdatePolicy.permission = ['catalog.bulk.execute'] as const satisfies PermissionRequirement;

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
useCreateNotice.permission = ['marketing.notice.write'] as const satisfies PermissionRequirement;

export const useUpdateNotice = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateNoticeDto }) =>
      products.notices.update(id, dto),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: productQueryKeys.notices });
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.notice(variables.id),
      });
    },
  });
};
useUpdateNotice.permission = ['marketing.notice.write'] as const satisfies PermissionRequirement;

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
useDeleteNotice.permission = ['marketing.notice.write'] as const satisfies PermissionRequirement;

// ===== 아몬드템플릿 뮤테이션 =====

const useInvalidateAlmondTemplates = () => {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: productQueryKeys.almondTemplates });
  };
};

export const useUpdateAlmondTemplateStatus = () => {
  const invalidate = useInvalidateAlmondTemplates();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: AlmondTemplateStatus }) =>
      products.almondTemplates.updateStatus(id, status),
    onSuccess: () => invalidate(),
  });
};
useUpdateAlmondTemplateStatus.permission = ['marketing.almond_template.write'] as const satisfies PermissionRequirement;

export const useDeleteAlmondTemplate = () => {
  const invalidate = useInvalidateAlmondTemplates();
  return useMutation({
    mutationFn: (id: string) => products.almondTemplates.remove(id),
    onSuccess: () => invalidate(),
  });
};
useDeleteAlmondTemplate.permission = ['marketing.almond_template.write'] as const satisfies PermissionRequirement;

// ===== 샵매매 뮤테이션 =====

const useInvalidateShopListings = () => {
  const queryClient = useQueryClient();
  return (id?: string) => {
    void queryClient.invalidateQueries({ queryKey: productQueryKeys.shopListings });
    if (id) void queryClient.invalidateQueries({ queryKey: productQueryKeys.shopListing(id) });
  };
};

export const useCreateShopListing = () => {
  const invalidate = useInvalidateShopListings();
  return useMutation({
    mutationFn: (payload: AdminShopListingPayload) => products.shopListings.create(payload),
    onSuccess: () => invalidate(),
  });
};
useCreateShopListing.permission = ['marketing.shop_listing.write'] as const satisfies PermissionRequirement;

export const useUpdateShopListing = () => {
  const invalidate = useInvalidateShopListings();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: AdminShopListingPayload }) =>
      products.shopListings.update(id, payload),
    onSuccess: (_, { id }) => invalidate(id),
  });
};
useUpdateShopListing.permission = ['marketing.shop_listing.write'] as const satisfies PermissionRequirement;

export const useDeleteShopListing = () => {
  const invalidate = useInvalidateShopListings();
  return useMutation({
    mutationFn: (id: string) => products.shopListings.remove(id),
    onSuccess: () => invalidate(),
  });
};
useDeleteShopListing.permission = ['marketing.shop_listing.write'] as const satisfies PermissionRequirement;

export const useApproveShopListing = () => {
  const invalidate = useInvalidateShopListings();
  return useMutation({
    mutationFn: ({ id, expectedSubmittedAt }: { id: string; expectedSubmittedAt: string | null }) =>
      products.shopListings.approve(id, expectedSubmittedAt),
    // 409(그사이 수정)여도 상세를 새로 읽어야 하므로 성공·실패 모두 무효화한다
    onSettled: (_, __, { id }) => invalidate(id),
  });
};
useApproveShopListing.permission = ['marketing.shop_listing.write'] as const satisfies PermissionRequirement;

export const useRejectShopListing = () => {
  const invalidate = useInvalidateShopListings();
  return useMutation({
    mutationFn: ({
      id,
      reason,
      expectedSubmittedAt,
    }: {
      id: string;
      reason: string;
      expectedSubmittedAt: string | null;
    }) => products.shopListings.reject(id, reason, expectedSubmittedAt),
    onSettled: (_, __, { id }) => invalidate(id),
  });
};
useRejectShopListing.permission = ['marketing.shop_listing.write'] as const satisfies PermissionRequirement;

export const useShopListingTransition = (kind: 'hide' | 'unhide' | 'close' | 'reopen') => {
  const invalidate = useInvalidateShopListings();
  return useMutation({
    mutationFn: (id: string) => products.shopListings[kind](id),
    onSettled: (_, __, id) => invalidate(id),
  });
};
useShopListingTransition.permission = ['marketing.shop_listing.write'] as const satisfies PermissionRequirement;

// ===== 팝업 공지 뮤테이션 =====

export const useCreateSitePopup = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateSitePopupDto) => products.sitePopups.create(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productQueryKeys.sitePopups });
    },
  });
};
useCreateSitePopup.permission = ['marketing.display.write'] as const satisfies PermissionRequirement;

export const useUpdateSitePopup = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateSitePopupDto }) =>
      products.sitePopups.update(id, dto),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: productQueryKeys.sitePopups });
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.sitePopup(variables.id),
      });
    },
  });
};
useUpdateSitePopup.permission = ['marketing.display.write'] as const satisfies PermissionRequirement;

export const useResetSitePopupDismissals = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => products.sitePopups.resetDismissals(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: productQueryKeys.sitePopups });
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.sitePopup(id),
      });
    },
  });
};
useResetSitePopupDismissals.permission = ['marketing.display.write'] as const satisfies PermissionRequirement;

export const useDeleteSitePopup = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => products.sitePopups.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productQueryKeys.sitePopups });
    },
  });
};
useDeleteSitePopup.permission = ['marketing.display.write'] as const satisfies PermissionRequirement;

/**
 * 필터 결과 전체 선택. 버튼을 누른 순간에만 도는 일회성 조회라 useQuery 가 아니라
 * useMutation 이다 — useQuery 로 두면 필터가 바뀔 때마다 최대 5000건을 미리 당겨온다.
 */
export const useMasterSelection = () => {
  return useMutation({
    mutationFn: (query: MastersQuery) => products.masters.getSelection(query),
  });
};
useMasterSelection.permission = ['catalog.product.read'] as const satisfies PermissionRequirement;
