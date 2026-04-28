// src/lib/services/products/mutations.ts
// PIM API 뮤테이션 훅

'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { productQueryKeys } from './query-keys';
import { products } from '@/lib/api/domains';
import type {
  CreateCategoryDto,
  UpdateCategoryDto,
  MoveCategoryDto,
  CreateMasterDto,
  UpdateMasterDto,
  UpdatePricingStrategyDto,
  UpdateVariantDto,
  BulkUpdateVariantDto,
  UpdateVariantStatusDto,
  CreateChannelDto,
  UpdateChannelDto,
  UpdateChannelStatusDto,
  ValidateChannelConfigDto,
  CreateChannelProductDto,
  UpdateChannelProductDto,
  UpdateChannelProductNameDto,
  UpdateChannelProductStatusDto,
  CreateBannerGroupDto,
  UpdateBannerGroupDto,
  CreateBannerDto,
  UpdateBannerDto,
  CreateTagGroupDto,
  UpdateTagGroupDto,
  CreateTagValueDto,
  UpdateTagValueDto,
  ReplacePricingRulesDto,
  CalculatePriceRequestDto,
  CreateDraftVersionDto,
} from '@/lib/types/dto/products';

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

// ===== 제품 마스터 관련 뮤테이션 =====

/**
 * 제품 마스터 생성
 */
export const useCreateMaster = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateMasterDto) => products.masters.create(data),
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

// ===== 제품 변형 관련 뮤테이션 =====

/**
 * 제품 변형 수정
 */
export const useUpdateVariant = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateVariantDto }) =>
      products.variants.update(id, data),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.variants,
      });
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.variant(variables.id),
      });
    },
  });
};

/**
 * 제품 변형 일괄 수정
 */
export const useBulkUpdateVariants = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: BulkUpdateVariantDto) =>
      products.variants.bulkUpdate(data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.variants,
      });
    },
  });
};

/**
 * 제품 변형 상태 수정
 */
export const useUpdateVariantStatus = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateVariantStatusDto }) =>
      products.variants.updateStatus(id, data),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.variants,
      });
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.variant(variables.id),
      });
    },
  });
};

// ===== 판매 채널 관련 뮤테이션 =====

/**
 * 판매 채널 생성
 */
export const useCreateChannel = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateChannelDto) => products.channels.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.channels,
      });
    },
  });
};

/**
 * 판매 채널 수정
 */
export const useUpdateChannel = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateChannelDto }) =>
      products.channels.update(id, data),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.channels,
      });
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.channel(variables.id),
      });
    },
  });
};

/**
 * 판매 채널 삭제
 */
export const useDeleteChannel = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => products.channels.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.channels,
      });
    },
  });
};

/**
 * 판매 채널 상태 설정
 */
export const useUpdateChannelStatus = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateChannelStatusDto }) =>
      products.channels.updateStatus(id, data),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.channels,
      });
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.channel(variables.id),
      });
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.activeChannels(),
      });
    },
  });
};

/**
 * 판매 채널 설정 검증
 */
export const useValidateChannelConfig = () => {
  return useMutation({
    mutationFn: (data: ValidateChannelConfigDto) =>
      products.channels.validateConfig(data),
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

// ===== 가격 관리 뮤테이션 =====

export const useReplaceVersionPricingRules = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ versionId, dto }: { versionId: string; dto: ReplacePricingRulesDto }) =>
      products.pricing.versions.replaceRules(versionId, dto),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.pricingVersionRules(variables.versionId),
      });
    },
  });
};

export const useDeleteVersionPricingRules = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ versionId }: { versionId: string }) =>
      products.pricing.versions.deleteRules(versionId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: productQueryKeys.pricingVersionRules(variables.versionId),
      });
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
