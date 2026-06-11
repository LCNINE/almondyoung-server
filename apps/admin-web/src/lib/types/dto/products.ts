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
  slug?: string;
  imageUrl?: string;
  parentId?: string | null;
  sortOrder?: number;
}

export interface UpdateCategoryDto {
  name?: string;
  description?: string;
  slug?: string;
  imageUrl?: string;
  sortOrder?: number;
  isActive?: boolean;
}

export interface CategoryDto {
  id: string;
  name: string;
  description?: string;
  slug?: string;
  parentId?: string | null;
  level?: number;
  sortOrder?: number;
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
  sortOrder?: number;
}

// ===== 제품 마스터 관련 =====

/**
 * POST /masters only opens a product master and its initial draft version.
 * Product fields are edited later through version-scoped draft surfaces.
 */
export type CreateMasterDto = Record<string, never>;

export interface CreateMasterResponseDto {
  id: string;
  masterId: string;
  version: number;
  status: VersionStatus;
  name: string;
}

export interface UpdateMasterDto {
  name?: string;
  description?: string | null;
  descriptionHtml?: string | null;
  basePrice?: number;
  pricingStrategy?: PricingStrategy;
  brand?: string;
  status?: ProductStatus;
  images?: string[];
  specifications?: Record<string, string>;
  tags?: string[];
}

/**
 * @deprecated 백엔드 `ProductMasterDto` 응답과 어긋남.
 * `basePrice`, `pricingStrategy`, `tags`, `categories`, `variants`,
 * `channelProducts`, `specifications` 는 백엔드 응답에 존재하지 않음 (phantom 필드).
 * 신규 코드는 `ProductMasterDetail` (lib/services/products/products-detail.types.ts) 사용.
 * 전체 정합 정비는 별도 PR — 기존 7+ 곳 consumer 동시 수정 필요.
 */
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
  q?: string;
  /** @deprecated GET /masters uses q for keyword search. */
  search?: string;
  pricingStrategy?: PricingStrategy;
  brand?: string;
  categoryId?: string;
  status?: ProductStatus;
  /** active(기본): active 버전만 / active-or-inactive: active 우선, 없으면 최신 inactive 포함 */
  mode?: 'active' | 'active-or-inactive';
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

// ===== 마스터 목록 요약 응답 (GET /masters - ProductSummaryDto) =====
// 백엔드 ProductSummaryDto 와 1:1 대응. 목록 API 가 실제로 반환하는 모양이다.

export interface PriceSummaryDto {
  minBasePrice: number;
  maxBasePrice: number;
  minMembershipPrice: number;
  maxMembershipPrice: number;
  hasTieredPrices: boolean;
}

export interface MasterSummaryDto {
  masterId: string;
  versionId: string;
  name: string;
  /** 대표 이미지의 fileId. URL 아님 — file-service 경로로 변환 필요. */
  thumbnail: string | null;
  brand: string | null;
  isMembershipOnly: boolean;
  status: ProductStatus;
  createdAt: string;
  optionGroupNames: string[];
  variantCount: number;
  priceSummary: PriceSummaryDto | null;
}

export interface MasterSummaryListResponseDto {
  data: MasterSummaryDto[];
  total: number;
  page: number;
  limit: number;
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

/**
 * @deprecated 백엔드 `VariantWithPriceDto` 응답과 어긋남.
 * `name`, `sku`, `optionKey`, `images`, `specifications`, `inventory` 는 백엔드 응답에 존재하지 않음 (phantom 필드).
 * 백엔드 응답의 실제 필드는 `variantName`, `imageId`, `displayOrder`, `isDefault`, `optionValues` 등.
 * 신규 코드는 `ProductVariantRow` (lib/services/products/products-detail.types.ts) 사용.
 */
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

// ===== 판매 채널 관련 =====

export interface CreateChannelDto {
  type: ChannelType;
  name: string;
  description?: string;
  config?: Record<string, any>;
  isActive?: boolean;
}

export interface UpdateChannelDto {
  type?: ChannelType;
  name?: string;
  description?: string;
  config?: Record<string, any>;
  isActive?: boolean;
}

export interface ChannelDto {
  id: string;
  type: ChannelType;
  name: string;
  description?: string;
  config?: Record<string, any>;
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

// ===== 배너 그룹 관련 =====

export interface CreateBannerGroupDto {
  code: string;
  title: string;
  category?: string;
  pcWidth?: number;
  pcHeight?: number;
  mobileWidth?: number;
  mobileHeight?: number;
  description?: string;
  isActive?: boolean;
  sortOrder?: number;
  createdBy?: string;
}

export interface UpdateBannerGroupDto {
  title?: string;
  category?: string;
  pcWidth?: number;
  pcHeight?: number;
  mobileWidth?: number;
  mobileHeight?: number;
  description?: string;
  isActive?: boolean;
  sortOrder?: number;
  updatedBy?: string;
}

export interface BannerGroupDto {
  id: string;
  code: string;
  title: string;
  category?: string;
  pcWidth?: number;
  pcHeight?: number;
  mobileWidth?: number;
  mobileHeight?: number;
  description?: string;
  isActive: boolean;
  sortOrder?: number;
  createdBy?: string;
  updatedBy?: string;
  deletedAt?: string;
  deletedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BannerGroupListQuery {
  category?: string;
}

// ===== 배너 관련 =====

export interface CreateBannerDto {
  bannerGroupId: string;
  title: string;
  description?: string;
  pcImageFileId?: string;
  mobileImageFileId?: string;
  linkUrl?: string;
  linkedProductMasterIds?: string[];
  displayStartAt?: string;
  displayEndAt?: string;
  isActive?: boolean;
  sortOrder?: number;
  createdBy?: string;
}

export interface UpdateBannerDto {
  title?: string;
  description?: string;
  pcImageFileId?: string;
  mobileImageFileId?: string;
  linkUrl?: string;
  linkedProductMasterIds?: string[];
  displayStartAt?: string;
  displayEndAt?: string;
  isActive?: boolean;
  sortOrder?: number;
  updatedBy?: string;
}

export interface BannerDto {
  id: string;
  bannerGroupId: string;
  title: string;
  description?: string;
  pcImageFileId?: string;
  mobileImageFileId?: string;
  linkUrl?: string;
  linkedProductMasterIds?: string[];
  displayStartAt?: string;
  displayEndAt?: string;
  isActive: boolean;
  sortOrder?: number;
  createdBy?: string;
  updatedBy?: string;
  deletedAt?: string;
  deletedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BannerGroupWithBannersDto extends BannerGroupDto {
  banners: BannerDto[];
}

// ===== 공지사항 관련 =====

export interface CreateNoticeDto {
  title: string;
  content: string;
  category?: string;
  badge?: string;
  isPinned?: boolean;
  displayStartAt?: string;
  displayEndAt?: string;
  isActive?: boolean;
  sortOrder?: number;
  createdBy?: string;
}

export interface UpdateNoticeDto {
  title?: string;
  content?: string;
  category?: string;
  badge?: string | null;
  isPinned?: boolean;
  displayStartAt?: string;
  displayEndAt?: string;
  isActive?: boolean;
  sortOrder?: number;
  updatedBy?: string;
}

export interface NoticeDto {
  id: string;
  title: string;
  content: string;
  category: string;
  badge: string | null;
  isPinned: boolean;
  displayStartAt: string | null;
  displayEndAt: string | null;
  isActive: boolean;
  sortOrder: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NoticeListQuery {
  category?: string;
  includeInactive?: boolean;
  isActive?: boolean;
  isPinned?: boolean;
  badge?: string;
  q?: string;
}

// ===== 태그 그룹 관련 =====

export interface CreateTagGroupDto {
  name: string;
  description?: string;
  displayOrder?: number;
  isActive?: boolean;
}

export interface UpdateTagGroupDto {
  name?: string;
  description?: string;
  displayOrder?: number;
  isActive?: boolean;
}

export interface TagGroupDto {
  id: string;
  name: string;
  description?: string;
  displayOrder?: number;
  isActive: boolean;
  valueCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface TagGroupListQuery {
  isActive?: boolean;
}

// ===== 태그 값 관련 =====

export interface CreateTagValueDto {
  name: string;
  displayOrder?: number;
  isActive?: boolean;
}

export interface UpdateTagValueDto {
  name?: string;
  displayOrder?: number;
  isActive?: boolean;
}

export interface TagValueDto {
  id: string;
  groupId: string;
  groupName?: string;
  name: string;
  displayOrder?: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ===== 가격 관리 (Pricing) =====

export type PricingLayer = 'base_price' | 'membership_price' | 'tiered_price';
export type PricingScopeType = 'all_variants' | 'with_option' | 'variants';
export type PricingOperationType = 'offset' | 'scale' | 'override';
export type CustomerType = 'regular' | 'membership';

export interface PricingRuleResponseDto {
  id: string;
  layer: PricingLayer;
  order: number;
  scopeType: PricingScopeType;
  scopeTargetIds: string[] | null;
  operationType: PricingOperationType;
  operationValue: number;
  minQuantity: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface PricingRulesResponseDto {
  basePriceRules: PricingRuleResponseDto[];
  membershipPriceRules: PricingRuleResponseDto[];
  tieredPriceRules: PricingRuleResponseDto[];
}

export interface PricingRuleInput {
  order: number;
  layer: PricingLayer;
  scopeType: PricingScopeType;
  scopeTargetIds?: string[];
  operationType: PricingOperationType;
  operationValue: number;
  minQuantity?: number;
}

export interface ReplacePricingRulesDto {
  basePriceRules: PricingRuleInput[];
  membershipPriceRules: PricingRuleInput[];
  tieredPriceRules: PricingRuleInput[];
}

export interface CalculatePriceRequestDto {
  variantId: string;
  quantity?: number;
  customerType?: CustomerType;
}

export interface AppliedRuleDto {
  ruleId: string;
  layer: PricingLayer;
  order: number;
  scopeType: PricingScopeType;
  operationType: PricingOperationType;
  operationValue: number;
  priceBeforeRule: number;
  priceAfterRule: number;
}

export interface PriceBreakdownDto {
  initialPrice: number;
  afterBasePrice: number;
  afterMembershipPrice?: number;
  afterTieredPrice?: number;
}

export interface CalculatePriceResponseDto {
  variantId: string;
  price: number;
  totalPrice?: number;
  appliedRules: AppliedRuleDto[];
  priceBreakdown: PriceBreakdownDto;
}

export interface TieredPriceDto {
  minQuantity: number;
  price: number;
}

export interface VariantPriceSetDto {
  basePrice: number;
  membershipPrice: number;
  tieredPrices: TieredPriceDto[];
}

// ===== 버전 관련 =====

export type VersionStatus = 'draft' | 'active' | 'inactive';

export interface MasterVersionDto {
  id: string;
  masterId: string;
  version: number;
  status: VersionStatus;
  name: string;
  parentVersionId: string | null;
  children: MasterVersionDto[];
  createdAt: string;
  updatedAt: string;
  draftOwnerId?: string | null;
}

export interface CreateDraftVersionDto {
  parentVersionId?: string;
  copyMappings?: boolean;
}

// ===== 채널 리스팅 =====

export interface ChannelListingDto {
  id: string;
  variantId: string;
  salesChannelId: string;
  channelItemId: string;
  channelItemName: string | null;
  channelOptionName: string | null;
  channelPrice: number | null;
  channelProductUrl: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelSiteInfoDto {
  id: string;
  name: string;
  site: string;
}

export interface ChannelListingWithChannelDto {
  id: string;
  channelItemId: string;
  channelItemName: string | null;
  channelOptionName: string | null;
  channelPrice: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  channel: ChannelSiteInfoDto;
}

export interface ChannelListingListResponseDto {
  data: ChannelListingWithChannelDto[];
  total: number;
}

export interface CreateChannelListingDto {
  variantId: string;
  salesChannelId: string;
  channelItemId: string;
  channelItemName?: string;
  channelOptionName?: string;
  channelPrice?: number;
  channelProductUrl?: string;
}

export interface UpdateChannelListingDto {
  channelItemId?: string;
  channelItemName?: string;
  channelOptionName?: string;
  channelPrice?: number;
  channelProductUrl?: string;
}

// ===== 채널 카테고리 =====

export interface ChannelCategoryDto {
  id: string;
  name: string;
  description: string | null;
  displayOrder: number;
  channelCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelCategoryListResponseDto {
  data: ChannelCategoryDto[];
}

export interface CreateChannelCategoryDto {
  name: string;
  description?: string;
  displayOrder?: number;
}

export interface UpdateChannelCategoryDto {
  name?: string;
  description?: string;
  displayOrder?: number;
}

// ===== 일괄 작업 관련 =====

export interface BulkUpdateDto {
  productIds: string[];
  status?: 'active' | 'inactive';
  approvalStatus?: 'draft' | 'pending' | 'approved' | 'rejected';
  basePrice?: number;
  brand?: string;
  seller?: string;
}

export interface BulkDeleteDto {
  productIds: string[];
}

export interface BulkRestoreDto {
  productIds: string[];
}

export interface BulkOperationResultDto {
  success: boolean;
  affected: number;
}

export interface BulkUpdateFailureDto {
  masterId: string;
  name: string | null;
  reason: string;
}

// 백엔드 POST /masters/bulk/update 실제 응답 모양.
export interface BulkUpdateResultDto {
  updated: number;
  products: unknown[];
  /** status: 'active'(일괄 재공개) 경로에서만 채워진다 — 검증 실패한 상품 목록. */
  failed?: BulkUpdateFailureDto[];
}

// ===== CSV 관련 =====

export interface CsvImportResultDto {
  success: boolean;
  imported: number;
  failed: number;
  errors: string[];
}

// ===== 감사 로그 관련 =====

export interface AuditLogItemDto {
  id: string;
  productId: string;
  action: string;
  userId: string;
  createdAt: string;
}

export interface ProductAuditHistoryItemDto extends AuditLogItemDto {
  changes?: Record<string, { old: unknown; new: unknown }> | null;
}

// ===== 승인 관련 =====

export interface PendingApprovalDto {
  id: string;
  name: string;
  approvalStatus: string;
  submittedAt?: string;
  submittedBy?: string;
}

export interface ApprovalHistoryItemDto {
  id: string;
  productId: string;
  action: 'submit' | 'approve' | 'reject';
  actorId: string;
  comment?: string;
  reason?: string;
  createdAt: string;
}

export interface ApproveProductDto {
  comment?: string;
}

export interface RejectProductDto {
  reason: string;
}
