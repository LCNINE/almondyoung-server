// src/lib/types/dto/products.ts
// PIM API 스펙 기반 상품 관련 DTO 타입 정의

import type { UUID } from './common';

// ===== 공통 타입 =====
export type ProductStatus = 'active' | 'inactive' | 'draft' | 'archived';
export type ChannelType = string;
// 필요하면 UI 레벨에서만 선택지 상수로 제한
export const KNOWN_CHANNEL_TYPES = ['medusa', 'coupang', 'smartstore'] as const;
export type PricingStrategy = 'option_based' | 'variant_based';

// ===== 카테고리 관련 =====

export interface CreateCategoryDto {
  name: string;
  description?: string;
  parentId?: string | null;
}

export interface UpdateCategoryDto {
  name?: string;
  description?: string;
  parentId?: string | null;
}

export interface CategoryDto {
  id: string;
  name: string;
  description?: string;
  parentId?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  children?: CategoryDto[];
  path?: Array<{ id: string; name: string }>;
}

// 호환성을 위한 타입 별칭
export type CategoryResponseDto = CategoryDto;

export interface CategoryTreeResponseDto {
  categories: CategoryDto[];
  totalCount: number;
  maxDepth: number;
}

export interface CategoryPathResponseDto {
  categoryId: string;
  path: Array<{ id: string; name: string }>;
}

export interface MoveCategoryDto {
  newParentId?: string | null;
}

// ===== 제품 마스터 관련 =====

export interface CreateMasterDto {
  name: string;
  description?: string;
  basePrice: number;
  pricingStrategy: PricingStrategy;
  brand?: string;
  status?: ProductStatus;
  images?: string[];
  specifications?: Record<string, string>;
  tags?: string[];
}

export interface UpdateMasterDto {
  name?: string;
  description?: string;
  basePrice?: number;
  pricingStrategy?: PricingStrategy;
  brand?: string;
  status?: ProductStatus;
  images?: string[];
  specifications?: Record<string, string>;
  tags?: string[];
}

export interface MasterDto {
  id: string;
  name: string;
  description?: string;
  basePrice: number;
  pricingStrategy: PricingStrategy;
  brand?: string;
  status: ProductStatus;
  images?: string[];
  specifications?: Record<string, string>;
  tags?: string[];
  categories?: CategoryDto[];
  createdAt: string;
  updatedAt: string;
  variants?: VariantDto[];
  channelProducts?: ChannelProductDto[];
}

export interface MastersQuery {
  search?: string;
  pricingStrategy?: PricingStrategy;
  brand?: string;
  categoryId?: string;
  status?: ProductStatus;
  limit?: number;
  page?: number;
}

export interface MastersResponseDto {
  data: MasterDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface PricePreviewDto {
  masterId: string;
  basePrice: number;
  calculatedPrice: number;
  pricingStrategy: PricingStrategy;
  appliedRules?: Array<{
    type: string;
    description: string;
    adjustment: number;
  }>;
}

export interface UpdatePricingStrategyDto {
  pricingStrategy: PricingStrategy;
  migrationData?: Record<string, string>;
}

// ===== 제품 변형 관련 =====

export interface CreateVariantDto {
  masterId: string;
  name: string;
  sku?: string;
  optionKey?: Record<string, string>;
  price?: number;
  status?: ProductStatus;
  images?: string[];
  specifications?: Record<string, string>;
  inventory?: {
    trackQuantity: boolean;
    allowBackorder: boolean;
    minOrderQuantity?: number;
    maxOrderQuantity?: number;
  };
}

export interface UpdateVariantDto {
  name?: string;
  sku?: string;
  optionKey?: Record<string, string>;
  price?: number;
  status?: ProductStatus;
  images?: string[];
  specifications?: Record<string, string>;
  inventory?: {
    trackQuantity?: boolean;
    allowBackorder?: boolean;
    minOrderQuantity?: number;
    maxOrderQuantity?: number;
  };
}

export interface VariantDto {
  id: string;
  masterId: string;
  master?: MasterDto;
  name: string;
  sku?: string;
  optionKey?: Record<string, string>;
  price?: number;
  calculatedPrice?: number;
  status: ProductStatus;
  images?: string[];
  specifications?: Record<string, string>;
  inventory?: {
    trackQuantity: boolean;
    allowBackorder: boolean;
    minOrderQuantity?: number;
    maxOrderQuantity?: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface VariantsQuery {
  masterId: string;
  limit?: number;
  page?: number;
  includePrice?: boolean;
  status?: ProductStatus;
}

export interface VariantsResponseDto {
  data: VariantDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface BulkUpdateVariantDto {
  variants: Array<{
    id: string;
    updates: UpdateVariantDto;
  }>;
}

export interface VariantPriceDto {
  variantId: string;
  price: number;
  basePrice?: number;
  calculatedPrice: number;
  pricingStrategy: PricingStrategy;
  appliedRules?: Array<{
    type: string;
    description: string;
    adjustment: number;
  }>;
}

export interface UpdateVariantStatusDto {
  status: ProductStatus;
}

// ===== 판매 채널 관련 =====

export interface CreateChannelDto {
  type: ChannelType;
  name: string;
  description?: string;
  config?: Record<string, string>;
  isActive?: boolean;
}

export interface UpdateChannelDto {
  type?: ChannelType;
  name?: string;
  description?: string;
  config?: Record<string, string>;
  isActive?: boolean;
}

export interface ChannelDto {
  id: string;
  type: ChannelType;
  name: string;
  description?: string;
  config?: Record<string, string>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  channelProducts?: ChannelProductDto[];
}

export interface ChannelsQuery {
  limit?: number;
  page?: number;
  search?: string;
  type?: ChannelType;
  isActive?: boolean;
}

export interface ChannelsResponseDto {
  data: ChannelDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface ActiveChannelsResponseDto {
  channels: ChannelDto[];
}

export interface UpdateChannelStatusDto {
  isActive: boolean;
}

export interface ValidateChannelConfigDto {
  type: ChannelType;
  config: Record<string, string>;
}

export interface ChannelValidationResponseDto {
  isValid: boolean;
  errors: string[];
}

// ===== 채널별 제품 관련 =====

export interface CreateChannelProductDto {
  masterId: string;
  channelId: string;
  name?: string;
  description?: string;
  price?: number;
  isActive?: boolean;
  channelSpecificData?: Record<string, string>;
  images?: string[];
  specifications?: Record<string, string>;
}

export interface UpdateChannelProductDto {
  name?: string;
  description?: string;
  price?: number;
  isActive?: boolean;
  channelSpecificData?: Record<string, string>;
  images?: string[];
  specifications?: Record<string, string>;
}

export interface ChannelProductDto {
  id: string;
  masterId: string;
  master?: MasterDto;
  channelId: string;
  channel?: ChannelDto;
  name?: string;
  description?: string;
  price?: number;
  isActive: boolean;
  channelSpecificData?: Record<string, string>;
  images?: string[];
  specifications?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelProductsQuery {
  channelId: string;
  limit?: number;
  page?: number;
  search?: string;
  isActive?: boolean;
}

export interface ChannelProductsResponseDto {
  data: ChannelProductDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface MasterChannelProductsResponseDto {
  channelProducts: ChannelProductDto[];
}

export interface MergedChannelProductDto {
  master: MasterDto;
  channelProduct: ChannelProductDto;
  mergedData: {
    name: string;
    description?: string;
    price: number;
    images: string[];
    specifications: Record<string, string>;
    isActive: boolean;
  };
}

export interface UpdateChannelProductNameDto {
  name: string;
}

export interface UpdateChannelProductStatusDto {
  isActive: boolean;
}

// ===== 매칭 테이블용 특별 타입 =====

export interface MatchingTableRowDto {
  id: string;
  channelProduct: ChannelProductDto;
  variant?: VariantDto;
  matchedSku?: {
    skuId: string;
    quantity: number;
    barcode?: string;
  };
  orderInfo?: {
    quantity: number;
    salesAmount: number;
    recipient: string;
    orderDate: string;
  };
  matchingStatus: 'matched' | 'unmatched' | 'no_product';
  actions: {
    canMatch: boolean;
    canRematch: boolean;
    canEdit: boolean;
    canDelete: boolean;
    canCreate: boolean;
  };
}

export interface MatchingTableResponseDto {
  data: MatchingTableRowDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

// ===== 기존 호환성 타입 (점진적 마이그레이션용) =====

// 기존 CategoryDto와의 호환성
export interface LegacyCategoryDto {
  id: string;
  name: string;
  slug: string;
  description?: string;
  parent_id?: string;
  level: number;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  children?: LegacyCategoryDto[];
}

// 기존 ProductDto와의 호환성
export interface LegacyProductDto {
  id: string;
  name: string;
  description?: string;
  price: number;
  category_id?: string;
  status: string;
  created_at: string;
  updated_at: string;
}

// 기존 VariantDto와의 호환성
export interface LegacyVariantDto {
  id: string;
  product_id: string;
  name: string;
  sku?: string;
  price?: number;
  status: string;
  created_at: string;
  updated_at: string;
}
