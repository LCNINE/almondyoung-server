// PIM 마이크로서비스의 중앙 집중화된 타입 정의
import { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  productCategories,
  productMasters,
  productMasterCategories,
  productOptionGroups,
  productOptionValues,
  productVariants,
  variantOptionValues,
  salesChannels,
  channelProducts,
  pricingRules,
  uploads,
  productImages,
  productApprovalHistory,
  productAuditLog,
  type PimSchema,
} from './schema';

// ===== TRANSACTION 타입 =====
export type DbTransaction = PostgresJsDatabase<PimSchema>;

// ===== PRODUCT CATEGORIES 타입 =====

export type ProductCategory = InferSelectModel<typeof productCategories>;
export type NewProductCategory = InferInsertModel<typeof productCategories>;
export type UpdateProductCategory = Partial<
  Omit<NewProductCategory, 'id' | 'createdAt' | 'updatedAt'>
>;

// ===== PRODUCT MASTERS 타입 =====
export type ProductMaster = InferSelectModel<typeof productMasters>;
export type NewProductMaster = InferInsertModel<typeof productMasters>;
export type UpdateProductMaster = Partial<
  Omit<NewProductMaster, 'id' | 'createdAt' | 'updatedAt'>
> & {
  categoryIds?: string[];
  primaryCategoryId?: string;
  migrationData?: any;
};

// 채널 서비스는 기존 ProductMaster 타입 그대로 사용 (CTO 코드 유지)

// ===== PRODUCT MASTER CATEGORIES (Junction Table) 타입 =====
export type ProductMasterCategory = InferSelectModel<
  typeof productMasterCategories
>;
export type NewProductMasterCategory = InferInsertModel<
  typeof productMasterCategories
>;
export type UpdateProductMasterCategory = Partial<
  Omit<NewProductMasterCategory, 'id' | 'createdAt'>
>;

// ===== PRODUCT OPTION GROUPS 타입 =====
export type ProductOptionGroup = InferSelectModel<typeof productOptionGroups>;
export type NewProductOptionGroup = InferInsertModel<
  typeof productOptionGroups
>;
export type UpdateProductOptionGroup = Partial<
  Omit<NewProductOptionGroup, 'id' | 'createdAt' | 'updatedAt'>
>;

// ===== PRODUCT OPTION VALUES 타입 =====
export type ProductOptionValue = InferSelectModel<typeof productOptionValues>;
export type NewProductOptionValue = InferInsertModel<
  typeof productOptionValues
>;
export type UpdateProductOptionValue = Partial<
  Omit<NewProductOptionValue, 'id' | 'createdAt' | 'updatedAt'>
>;

// ===== PRODUCT VARIANTS 타입 =====
export type ProductVariant = InferSelectModel<typeof productVariants>;
export type NewProductVariant = InferInsertModel<typeof productVariants>;
export type UpdateProductVariant = Partial<
  Omit<NewProductVariant, 'id' | 'createdAt' | 'updatedAt'>
>;

// ===== VARIANT OPTION VALUES 타입 =====
export type VariantOptionValue = InferSelectModel<typeof variantOptionValues>;
export type NewVariantOptionValue = InferInsertModel<
  typeof variantOptionValues
>;
export type UpdateVariantOptionValue = Partial<
  Omit<NewVariantOptionValue, 'id' | 'createdAt' | 'updatedAt'>
>;

// ===== SALES CHANNELS 타입 =====
export type SalesChannel = InferSelectModel<typeof salesChannels>;
export type NewSalesChannel = InferInsertModel<typeof salesChannels>;
export type UpdateSalesChannel = Partial<
  Omit<NewSalesChannel, 'id' | 'createdAt' | 'updatedAt'>
>;

// ===== CHANNEL PRODUCTS 타입 =====
export type ChannelProduct = InferSelectModel<typeof channelProducts>;
export type NewChannelProduct = InferInsertModel<typeof channelProducts>;
export type UpdateChannelProduct = Partial<
  Omit<NewChannelProduct, 'id' | 'createdAt' | 'updatedAt'>
>;

// ===== PRICING RULES 타입 =====
export type PricingRule = InferSelectModel<typeof pricingRules>;
export type NewPricingRule = InferInsertModel<typeof pricingRules>;
export type UpdatePricingRule = Partial<
  Omit<NewPricingRule, 'id' | 'createdAt' | 'updatedAt'>
>;

// 가격 레이어 타입
export type PriceLayer = 'base_price' | 'membership_price' | 'tiered_price';

// 스코프 타입
export type ScopeType = 'all_variants' | 'with_option' | 'variants';

// 연산 타입
export type OperationType = 'offset' | 'scale' | 'override';

// ===== UPLOADS 타입 =====
export type Upload = InferSelectModel<typeof uploads>;
export type NewUpload = InferInsertModel<typeof uploads>;
export type UpdateUpload = Partial<Omit<NewUpload, 'id' | 'createdAt'>>;

// ===== PRODUCT IMAGES 타입 =====
export type ProductImage = InferSelectModel<typeof productImages>;
export type NewProductImage = InferInsertModel<typeof productImages>;
export type UpdateProductImage = Partial<
  Omit<NewProductImage, 'id' | 'createdAt'>
>;

// ===== 비즈니스 로직 DTO =====

// Product Master 생성 DTO
export interface CreateMasterDto {
  name: string;
  description?: string;
  brand?: string;
  thumbnail?: string; // 썸네일 이미지 URL (내부 또는 외부)
  categoryIds?: string[];
  primaryCategoryId?: string;
  basePrice: number;
  tags?: string[];
  images?: string[];
  attributes?: Record<string, any>;
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string[];

  // 구매제한 필드들
  isWholesaleOnly?: boolean;
  isMembershipOnly?: boolean;

  // 옵션 구조 정보 (가격 제외)
  optionGroups?: {
    name: string;
    displayName: string;
    sortOrder?: number;
    values: {
      value: string;
      displayName: string;
      sortOrder?: number;
    }[];
  }[];
}

// Product Master 목록용 DTO (간단한 정보만)
export interface MasterListItemDto {
  id: string;
  name: string;
  thumbnail?: string;
  basePrice: number;
  isMembershipOnly: boolean;
  status: string;
  createdAt: Date;
}

// Product Master 상세 응답 DTO (모든 정보 포함)
export interface MasterDetailDto extends ProductMaster {
  optionGroups: (ProductOptionGroup & {
    values: ProductOptionValue[];
  })[];
  variants: (ProductVariant & {
    optionValues: ProductOptionValue[];
    price?: number;
  })[];
  channelProducts: (ChannelProduct & {
    channel: SalesChannel;
  })[];
}

// Variant 일괄 수정 DTO
export interface UpdateVariantBulkDto {
  variantIds: string[];
  updates: {
    status?: string;
    displayOrder?: number;
    images?: string[];
  };
}

// 가격 조회 응답 DTO
export interface VariantWithPriceDto extends ProductVariant {
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
