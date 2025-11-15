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
  optionValuePrices,
  variantPrices,
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
  optionValuePrices?: Record<string, number>;
  variantPrices?: Record<string, number>;
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

// ===== OPTION VALUE PRICES 타입 =====
export type OptionValuePrice = InferSelectModel<typeof optionValuePrices>;
export type NewOptionValuePrice = InferInsertModel<typeof optionValuePrices>;
export type UpdateOptionValuePrice = Partial<
  Omit<NewOptionValuePrice, 'id' | 'createdAt' | 'updatedAt'>
>;

// ===== VARIANT PRICES 타입 =====
export type VariantPrice = InferSelectModel<typeof variantPrices>;
export type NewVariantPrice = InferInsertModel<typeof variantPrices>;
export type UpdateVariantPrice = Partial<
  Omit<NewVariantPrice, 'id' | 'createdAt' | 'updatedAt'>
>;

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

// ===== 가격 전략 관련 타입 =====
export type PricingStrategyType = 'option_based' | 'variant_based';

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
  pricingStrategy: PricingStrategyType;
  tags?: string[];
  images?: string[];
  attributes?: Record<string, any>;
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string[];

  // 구매제한 필드들
  isWholesaleOnly?: boolean;
  isMembershipOnly?: boolean;
  // 특별 가격 필드들
  membershipPrice?: number;
  wholesalePrice?: number;

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

  // 가격 데이터 (명시적 분리)
  optionValuePrices?: Record<string, number>; // option_based 전략용
  variantPrices?: Record<string, number>; // variant_based 전략용
}

// Product Master 목록용 DTO (간단한 정보만)
export interface MasterListItemDto {
  id: string;
  name: string;
  thumbnail?: string;
  basePrice: number;
  membershipPrice?: number;
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

// 가격 미리보기 DTO
export interface PricePreviewDto {
  masterId: string;
  variants: {
    variantId: string;
    optionCombination: string;
    price: number;
  }[];
}

// ===== PRODUCT APPROVAL HISTORY 타입 =====
export type ProductApprovalHistory = InferSelectModel<typeof productApprovalHistory>;
export type NewProductApprovalHistory = InferInsertModel<typeof productApprovalHistory>;

// ===== PRODUCT AUDIT LOG 타입 =====
export type ProductAuditLog = InferSelectModel<typeof productAuditLog>;
export type NewProductAuditLog = InferInsertModel<typeof productAuditLog>;
