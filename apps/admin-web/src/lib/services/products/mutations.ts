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
    mutationFn: ({ id, data }: { id: string; data: MoveCategoryDto }) =>
      products.categories.move(id, data.newParentId || undefined),
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
