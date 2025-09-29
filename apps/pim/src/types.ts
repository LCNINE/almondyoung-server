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
  membershipMappings,
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
>;

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

// ===== MEMBERSHIP MAPPINGS 타입 =====
export type MembershipMapping = InferSelectModel<typeof membershipMappings>;
export type NewMembershipMapping = InferInsertModel<typeof membershipMappings>;
export type UpdateMembershipMapping = Partial<
  Omit<NewMembershipMapping, 'id' | 'createdAt'>
>;

// ===== 가격 전략 관련 타입 =====
export type PricingStrategyType = 'option_based' | 'variant_based';

// ===== 비즈니스 로직 DTO =====

// Product Master 생성 DTO
export interface CreateMasterDto {
  name: string;
  description?: string;
  brand?: string;
  categoryId?: string;
  basePrice: number;
  pricingStrategy: PricingStrategyType;
  tags?: string[];
  images?: string[];
  attributes?: Record<string, any>;
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string[];

  // 옵션 정보
  optionGroups?: {
    name: string;
    displayName: string;
    sortOrder?: number;
    values: {
      value: string;
      displayName: string;
      sortOrder?: number;
      price?: number; // option_based 전략용
    }[];
  }[];

  // variant_based 전략용 품목별 가격
  variantPrices?: Record<string, number>; // 옵션 조합별 가격
}

// Product Master 상세 응답 DTO
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
