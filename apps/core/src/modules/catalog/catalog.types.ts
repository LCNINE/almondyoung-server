// PIM 마이크로서비스의 중앙 집중화된 타입 정의
import { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  productCategories,
  productMasters,
  productMasterVersions,
  productMasterCategories,
  productMasterOptionGroups,
  productMasterVariants,
  productMasterPricingRules,
  productPurchaseConstraints,
  productMasterPurchaseConstraints,
  productOptionGroupDisplays,
  productOptionValueDisplays,
  productOptionGroups,
  productOptionValues,
  productVariants,
  variantOptionValues,
  channelCategories,
  salesChannels,
  channelProducts,
  channelVariantListings,
  pricingRules,
  productVariantPriceCache,
  productImages,
  productApprovalHistory,
  productAuditLog,
  tagGroups,
  tagValues,
  categoryTagGroups,
  productTagValues,
  bannerGroups,
  banners,
  notices,
  type PimSchema,
} from './schema/catalog.schema';

// ===== TRANSACTION 타입 =====
export type DbTransaction = PostgresJsDatabase<PimSchema>;

// ===== VERSION MANAGEMENT 타입 =====
export type VersionStatus = 'draft' | 'inactive' | 'active';

// ===== PRODUCT CATEGORIES 타입 =====

export type ProductCategory = InferSelectModel<typeof productCategories>;
export type NewProductCategory = InferInsertModel<typeof productCategories>;
export type UpdateProductCategory = Partial<Omit<NewProductCategory, 'id' | 'createdAt' | 'updatedAt'>>;

// ===== PRODUCT MASTERS (메타데이터만) 타입 =====
export type ProductMaster = InferSelectModel<typeof productMasters>;
export type NewProductMaster = InferInsertModel<typeof productMasters>;
export type UpdateProductMaster = Partial<Omit<NewProductMaster, 'id' | 'createdAt'>>;

// ===== PRODUCT MASTER VERSIONS (버전별 상품 데이터) 타입 =====
export type ProductMasterVersion = InferSelectModel<typeof productMasterVersions>;
export type NewProductMasterVersion = InferInsertModel<typeof productMasterVersions>;
export type UpdateProductMasterVersion = Partial<
  Omit<NewProductMasterVersion, 'id' | 'masterId' | 'version' | 'createdAt' | 'updatedAt'>
> & {
  categoryIds?: string[];
  primaryCategoryId?: string;
  migrationData?: any;
  optionDiff?: OptionDiff;
  tagValueIds?: string[];
  thumbnailFileId?: string | null;
  additionalImageFileIds?: string[];
};

export type ProductMasterWithVersion = ProductMaster & {
  version: ProductMasterVersion;
};

// ===== PRODUCT MASTER CATEGORIES (Junction Table) 타입 =====
export type ProductMasterCategory = InferSelectModel<typeof productMasterCategories>;
export type NewProductMasterCategory = InferInsertModel<typeof productMasterCategories>;
export type UpdateProductMasterCategory = Partial<Omit<NewProductMasterCategory, 'id' | 'createdAt'>>;

// ===== PRODUCT MASTER OPTION GROUPS (Mapping Table) 타입 =====
export type ProductMasterOptionGroup = InferSelectModel<typeof productMasterOptionGroups>;
export type NewProductMasterOptionGroup = InferInsertModel<typeof productMasterOptionGroups>;

// ===== PRODUCT MASTER VARIANTS (Mapping Table) 타입 =====
export type ProductMasterVariant = InferSelectModel<typeof productMasterVariants>;
export type NewProductMasterVariant = InferInsertModel<typeof productMasterVariants>;

// ===== PRODUCT MASTER PRICING RULES (Mapping Table) 타입 =====
export type ProductMasterPricingRule = InferSelectModel<typeof productMasterPricingRules>;
export type NewProductMasterPricingRule = InferInsertModel<typeof productMasterPricingRules>;

export type ProductPurchaseConstraint = InferSelectModel<typeof productPurchaseConstraints>;
export type NewProductPurchaseConstraint = InferInsertModel<typeof productPurchaseConstraints>;
export type ProductMasterPurchaseConstraint = InferSelectModel<typeof productMasterPurchaseConstraints>;
export type NewProductMasterPurchaseConstraint = InferInsertModel<typeof productMasterPurchaseConstraints>;

export type PurchaseConstraintReadModel = {
  id: string;
  requiresMembership: boolean;
  lifetimeQuantityLimit: number | null;
};

// ===== PRODUCT OPTION GROUP DISPLAYS 타입 =====
export type ProductOptionGroupDisplay = InferSelectModel<typeof productOptionGroupDisplays>;
export type NewProductOptionGroupDisplay = InferInsertModel<typeof productOptionGroupDisplays>;

// ===== PRODUCT OPTION VALUE DISPLAYS 타입 =====
export type ProductOptionValueDisplay = InferSelectModel<typeof productOptionValueDisplays>;
export type NewProductOptionValueDisplay = InferInsertModel<typeof productOptionValueDisplays>;

// ===== OPTION DIFF 타입 =====
export interface OptionDiff {
  add?: AddOptionDto[];
  modifyDisplay?: ModifyOptionDisplayDto[];
  addValues?: AddOptionValuesDto[];
  removeValues?: RemoveOptionValuesDto[];
  remove?: string[];
}

export interface AddOptionDto {
  displayName: string;
  description?: string;
  sortOrder?: number;
  values: Array<{
    displayName: string;
    colorCode?: string;
    imageUrl?: string;
    sortOrder?: number;
  }>;
}

export interface ModifyOptionDisplayDto {
  optionGroupId: string;
  displayName?: string;
  description?: string;
  sortOrder?: number;
  values?: Array<{
    optionValueId: string;
    displayName?: string;
    colorCode?: string;
    imageUrl?: string;
    sortOrder?: number;
  }>;
}

export interface AddOptionValuesDto {
  optionGroupId: string;
  values: Array<{
    displayName: string;
    colorCode?: string;
    imageUrl?: string;
    sortOrder?: number;
  }>;
}

export interface RemoveOptionValuesDto {
  optionGroupId: string;
  optionValueIds: string[];
}

// ===== PRODUCT OPTION GROUPS 타입 =====
export type ProductOptionGroup = InferSelectModel<typeof productOptionGroups>;
export type NewProductOptionGroup = InferInsertModel<typeof productOptionGroups>;
export type UpdateProductOptionGroup = Partial<Omit<NewProductOptionGroup, 'id' | 'createdAt' | 'updatedAt'>>;

// ===== PRODUCT OPTION VALUES 타입 =====
export type ProductOptionValue = InferSelectModel<typeof productOptionValues>;
export type NewProductOptionValue = InferInsertModel<typeof productOptionValues>;
export type UpdateProductOptionValue = Partial<Omit<NewProductOptionValue, 'id' | 'createdAt' | 'updatedAt'>>;

// ===== PRODUCT VARIANTS 타입 =====
export type ProductVariant = InferSelectModel<typeof productVariants>;
export type NewProductVariant = InferInsertModel<typeof productVariants>;
export type UpdateProductVariant = Partial<Omit<NewProductVariant, 'id' | 'createdAt' | 'updatedAt'>>;

// ===== VARIANT OPTION VALUES 타입 =====
export type VariantOptionValue = InferSelectModel<typeof variantOptionValues>;
export type NewVariantOptionValue = InferInsertModel<typeof variantOptionValues>;
export type UpdateVariantOptionValue = Partial<Omit<NewVariantOptionValue, 'id' | 'createdAt' | 'updatedAt'>>;

// ===== CHANNEL CATEGORIES 타입 =====
export type ChannelCategory = InferSelectModel<typeof channelCategories>;
export type NewChannelCategory = InferInsertModel<typeof channelCategories>;
export type UpdateChannelCategory = Partial<Omit<NewChannelCategory, 'id' | 'createdAt' | 'updatedAt'>>;

// ===== SALES CHANNELS 타입 =====
export type SalesChannel = InferSelectModel<typeof salesChannels>;
export type NewSalesChannel = InferInsertModel<typeof salesChannels>;
export type UpdateSalesChannel = Partial<Omit<NewSalesChannel, 'id' | 'createdAt' | 'updatedAt'>>;

// ===== CHANNEL PRODUCTS 타입 =====
export type ChannelProduct = InferSelectModel<typeof channelProducts>;
export type NewChannelProduct = InferInsertModel<typeof channelProducts>;
export type UpdateChannelProduct = Partial<Omit<NewChannelProduct, 'id' | 'createdAt' | 'updatedAt'>>;

// ===== CHANNEL VARIANT LISTINGS 타입 (채널 상품 ↔ Variant 매핑) =====
export type ChannelVariantListing = InferSelectModel<typeof channelVariantListings>;
export type NewChannelVariantListing = InferInsertModel<typeof channelVariantListings>;
export type UpdateChannelVariantListing = Partial<Omit<NewChannelVariantListing, 'id' | 'createdAt' | 'updatedAt'>>;

// ===== PRICING RULES 타입 =====
export type PricingRule = InferSelectModel<typeof pricingRules>;
export type NewPricingRule = InferInsertModel<typeof pricingRules>;
export type UpdatePricingRule = Partial<Omit<NewPricingRule, 'id' | 'createdAt' | 'updatedAt'>>;

export type ProductVariantPriceCache = InferSelectModel<typeof productVariantPriceCache>;
export type NewProductVariantPriceCache = InferInsertModel<typeof productVariantPriceCache>;

// 가격 레이어 타입
export type PriceLayer = 'base_price' | 'membership_price' | 'tiered_price';

// 스코프 타입
export type ScopeType = 'all_variants' | 'with_option' | 'variants';

// 연산 타입
export type OperationType = 'offset' | 'scale' | 'override';

// ===== PRODUCT IMAGES 타입 =====
export type ProductImage = InferSelectModel<typeof productImages>;
export type NewProductImage = InferInsertModel<typeof productImages>;
export type UpdateProductImage = Partial<Omit<NewProductImage, 'id' | 'createdAt'>>;

// ===== 비즈니스 로직 DTO =====

// Product Master 생성 DTO
export interface CreateMasterDto {
  name?: string; // 선택사항, 기본값: "새 상품"
  description?: string;
  brand?: string;
  thumbnailFileId?: string; // 썸네일 파일 ID (file-service)
  additionalImageFileIds?: string[]; // 부가 이미지 파일 ID 배열 (file-service)
  categoryIds?: string[];
  primaryCategoryId?: string;
  // basePrice removed - 가격은 전적으로 pricing rules로 결정
  tags?: string[];
  images?: string[];
  attributes?: Record<string, any>;
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string[];

  // 구매제한 필드들
  isWholesaleOnly?: boolean;
  hideMembershipPriceForNonMembers?: boolean;
  isVisibleToMembersOnly?: boolean;
  /** @deprecated use hideMembershipPriceForNonMembers */
  isMembershipOnly?: boolean;

  // optionGroups removed - use update API with optionDiff instead
}

// Product Master 목록용 DTO (간단한 정보만)
export interface MasterListItemDto {
  id: string;
  name: string;
  thumbnail?: string;
  // basePrice removed - 가격은 pricing rules로 조회
  hideMembershipPriceForNonMembers: boolean;
  isVisibleToMembersOnly: boolean;
  /** @deprecated use hideMembershipPriceForNonMembers */
  isMembershipOnly: boolean;
  status: string;
  createdAt: Date;
}

export type OptionValueReadModel = {
  id: string;
  optionGroupId: string;
  displayName: string;
  sortOrder: number;
  createdAt: Date;
};

export type OptionGroupReadModel = {
  id: string;
  displayName: string;
  sortOrder: number;
  createdAt: Date;
  values: OptionValueReadModel[];
};

export type VariantOptionValueReadModel = OptionValueReadModel & {
  optionGroupName: string;
};

export type VariantReadModel = ProductVariant & {
  optionValues: VariantOptionValueReadModel[];
  price?: number;
  priceSet?: VariantPriceSet;
};

export type TagReadModel = {
  id: string;
  name: string;
  groupId: string;
  groupName: string;
  displayOrder: number;
};

export type ProductDetailCategory = {
  id: string;
  name: string;
  slug: string;
  path: string;
  parentId: string | null;
  isActive: boolean;
  isPrimary: boolean;
};

// Product Master 상세 응답 DTO (모든 정보 포함)
export interface ProductDetailDto extends ProductMasterVersion {
  images: ProductImage[];
  categories: ProductDetailCategory[];
  optionGroups: OptionGroupReadModel[];
  variants: VariantReadModel[];
  channelProducts: (ChannelProduct & {
    channel: SalesChannel;
  })[];
  tagValues?: TagReadModel[];
  priceSummary?: PriceSummary | null;
  purchaseConstraint?: PurchaseConstraintReadModel | null;
}

// 가격 조회 응답 DTO
export interface VariantWithPriceDto extends ProductVariant {
  masterId: string;
  versionId: string;
  price: number;
  optionValues: ProductOptionValue[];
}

// Channel Product 생성 DTO
export interface CreateChannelProductDto {
  masterId: string;
  channelId: string;
  name?: string; // 상품명 오버라이드
  isActive?: boolean;
  channelSpecificData?: Record<string, any>;
}

// NOTE: PricePreviewDto removed. Use PricingCalculatorService instead.

// ===== PRODUCT APPROVAL HISTORY 타입 =====
export type ProductApprovalHistory = InferSelectModel<typeof productApprovalHistory>;
export type NewProductApprovalHistory = InferInsertModel<typeof productApprovalHistory>;

// ===== PRODUCT AUDIT LOG 타입 =====
export type ProductAuditLog = InferSelectModel<typeof productAuditLog>;
export type NewProductAuditLog = InferInsertModel<typeof productAuditLog>;

// ===== 규칙 기반 가격 계산 시스템 타입 =====

// 단일 variant의 계산된 가격
export interface CalculatedVariantPrice {
  variantId: string;
  basePrice: number; // 일반가 (base_price 레이어 적용 결과)
  membershipPrice: number; // 멤버십가 (base + membership 레이어 적용 결과)
  tieredPrices: TieredPrice[]; // 도매가 (수량별)
}

export type PriceSummary = {
  minBasePrice: number;
  maxBasePrice: number;
  minMembershipPrice: number;
  maxMembershipPrice: number;
  hasTieredPrices: boolean;
};

// 수량별 도매가
export interface TieredPrice {
  minQuantity: number;
  price: number;
}

// 가격 계산 결과 (상세)
export interface PriceCalculationResult {
  variantId: string;
  price: number; // 최종 단가
  totalPrice?: number; // 수량 * 단가 (quantity가 주어진 경우)
  appliedRules: AppliedRuleInfo[]; // 적용된 규칙들
  priceBreakdown: {
    initialPrice: number;
    afterBasePrice: number;
    afterMembershipPrice?: number;
    afterTieredPrice?: number;
  };
}

// 적용된 규칙 정보
export interface AppliedRuleInfo {
  ruleId: string;
  layer: PriceLayer;
  order: number;
  scopeType: ScopeType;
  operationType: OperationType;
  operationValue: number;
  priceBeforeRule: number;
  priceAfterRule: number;
}

// 수량별 가격 정보
export interface TieredPriceInfo {
  minQuantity: number;
  price: number;
}

// Variant 가격 세트 (basePrice, membershipPrice, tieredPrices)
export interface VariantPriceSet {
  basePrice: number;
  membershipPrice: number;
  tieredPrices: TieredPriceInfo[];
}

// ===== TAG GROUPS 타입 =====
export type TagGroup = InferSelectModel<typeof tagGroups>;
export type NewTagGroup = InferInsertModel<typeof tagGroups>;
export type UpdateTagGroup = Partial<Omit<NewTagGroup, 'id' | 'createdAt' | 'updatedAt'>>;

// ===== TAG VALUES 타입 =====
export type TagValue = InferSelectModel<typeof tagValues>;
export type NewTagValue = InferInsertModel<typeof tagValues>;
export type UpdateTagValue = Partial<Omit<NewTagValue, 'id' | 'createdAt' | 'updatedAt'>>;

// ===== CATEGORY TAG GROUPS 타입 =====
export type CategoryTagGroup = InferSelectModel<typeof categoryTagGroups>;
export type NewCategoryTagGroup = InferInsertModel<typeof categoryTagGroups>;

// ===== PRODUCT TAG VALUES 타입 =====
export type ProductTagValue = InferSelectModel<typeof productTagValues>;
export type NewProductTagValue = InferInsertModel<typeof productTagValues>;

// ===== BANNER GROUPS 타입 =====
export type BannerGroup = InferSelectModel<typeof bannerGroups>;
export type NewBannerGroup = InferInsertModel<typeof bannerGroups>;
export type UpdateBannerGroup = Partial<Omit<NewBannerGroup, 'id' | 'createdAt' | 'updatedAt'>>;

// ===== BANNERS 타입 =====
export type Banner = InferSelectModel<typeof banners>;
export type NewBanner = InferInsertModel<typeof banners>;
export type UpdateBanner = Partial<Omit<NewBanner, 'id' | 'createdAt' | 'updatedAt'>>;

// ===== NOTICES 타입 =====
export type Notice = InferSelectModel<typeof notices>;
export type NewNotice = InferInsertModel<typeof notices>;
export type UpdateNotice = Partial<Omit<NewNotice, 'id' | 'createdAt' | 'updatedAt'>>;

// ===== VERSION MANAGEMENT DTO =====

// 버전 트리 노드
export interface VersionTreeNode {
  id: string;
  masterId: string;
  version: number;
  status: VersionStatus;
  name: string;
  parentVersionId: string | null;
  children: VersionTreeNode[];
  createdAt: Date;
  updatedAt: Date;
  draftOwnerId?: string | null;
}

// 버전 비교 DTO
export interface VersionDiffDto {
  field: string;
  oldValue: any;
  newValue: any;
}

// 버전 생성 요청 DTO
export interface CreateDraftVersionDto {
  parentVersionId: string;
  copyMappings?: boolean;
}

// Re-export new DTOs
export {
  ProductDto,
  ProductListItemDto,
  ProductListResponseDto,
} from './core/products/dto/products/product-response.dto';
export { ProductMasterMetadataDto } from './core/products/dto/products/product-master-metadata.dto';
