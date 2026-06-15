/**
 * Product Domain Stream Configuration
 *
 * PIM 상품 도메인 이벤트 스트림 정의
 */

import { event, stream } from '../types';
import { z } from 'zod';

// ===== Payload 타입 정의 =====

export interface ProductVariantCreatedPayload {
  masterId: string;
  versionId: string;
  productName: string;
  variantId: string;
  variantName: string | null;
  isDefault: boolean;
  status: 'active' | 'draft' | 'archived';

  // 🔑 WMS 매칭에 필요한 필드
  inventoryManagement: boolean;
  preStockSellable?: boolean;
  alwaysSellableZeroStock?: boolean;

  // 옵션 조합 정보 (디버깅용)
  optionCombination?: Array<{
    name: string;
    value: string;
  }>;

  createdAt: string; // ISO 8601
}

export interface ProductVariantUpdatedPayload {
  masterId: string;
  versionId: string;
  variantId: string;
  variantName?: string | null;
  status?: 'active' | 'draft' | 'archived';
  updatedAt: string;
}

export interface ProductVariantDeletedPayload {
  masterId: string;
  versionId: string;
  variantId: string;
  deletedAt: string;
}

export interface ProductInventoryManagementChangedPayload {
  masterId: string;
  versionId: string;
  productName: string;
  inventoryManagement: boolean;
  affectedVariants: Array<{
    variantId: string;
    variantName: string | null;
  }>;
  changedAt: string;
}

export interface ProductMasterActiveVersionChangedPayload {
  masterId: string;
  versionId: string | null;
  name: string | null;
  previousActiveVersionId: string | null;
  categoryIds?: string[];
  primaryCategoryId?: string | null;
  changeReason: 'published' | 'unpublished' | 'rollback';
  changedAt: string;
  snapshot?: ProductSnapshot | null;
}

export interface ProductPurchaseConstraintSnapshot {
  requiresMembership: boolean;
  lifetimeQuantityLimit: number | null;
}

export interface ProductSnapshot {
  masterId: string;
  versionId: string;
  version: number;
  name: string;
  description?: string;
  descriptionHtml?: string;
  thumbnail?: string;
  images?: Array<{
    fileId: string;
    url: string;
    isPrimary: boolean;
    sortOrder: number;
  }>;
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string;
  categories?: Array<{
    id: string;
    name: string;
    slug: string;
    path: string;
    parentId: string | null;
    isActive: boolean;
    visibility: boolean;
    showOnMainCategory: boolean;
    thumbnail?: string;
  }>;
  brand?: string;
  tags?: string[];
  productType?: string;
  fulfillmentKind?: 'physical' | 'digital';
  optionGroups?: Array<{
    id: string;
    name: string;
    values: Array<{
      id: string;
      name: string;
      colorCode?: string;
      imageUrl?: string;
    }>;
  }>;
  variants: Array<{
    id: string;
    variantName: string;
    sku: string;
    variantCode?: string;
    isDefault: boolean;
    status: string;
    optionCombination?: Array<{
      name: string;
      value: string;
    }>;
    basePrice: number;
    membershipPrice?: number;
    tieredPrices?: Array<{
      minQuantity: number;
      price: number;
    }>;
    weight?: number;
    length?: number;
    width?: number;
    height?: number;
    originCountry?: string;
    midCode?: string;
    hsCode?: string;
    material?: string;
  }>;
  status: 'active' | 'draft' | 'archived';
  isWholesaleOnly: boolean;
  /**
   * 멤버십가 공개 제한 플래그.
   * true면 비회원에게 멤버십가 숫자(variant.metadata.membershipPrice)를 숨기고
   * "멤버십 회원 공개"로 표시한다. 상품 노출/구매를 제한하는 플래그가 아니다 —
   * 구매 제한은 purchaseConstraint로 표현한다.
   * (주의: purchaseConstraint는 현재 Medusa metadata로 전파만 되고,
   *  Medusa cart/checkout 단의 구매 차단 enforcement는 아직 구현되지 않았다.)
   */
  isMembershipOnly: boolean;
  isGiftcard: boolean;
  discountable: boolean;
  purchaseConstraint?: ProductPurchaseConstraintSnapshot;
}

export interface ProductMasterDeletedPayload {
  masterId: string;
  deletedAt: string;
}

export interface CategoryChangedPayload {
  categoryId: string;
  changeType: 'created' | 'updated' | 'deleted' | 'moved';
  timestamp: string; // ISO 8601
  category: CategorySnapshot | null; // null only if deleted
}

export interface CategorySnapshot {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  parentId: string | null;
  level: number;
  path: string;
  sortOrder: number;
  isActive: boolean;
  visibility: boolean;
  thumbnail: string | null;
  displaySettings: Record<string, any> | null;
  seoConfig: Record<string, any> | null;
  templateConfig: Record<string, any> | null;
  createdAt: string;
  updatedAt: string;
}

// ===== Zod 스키마 정의 =====

const OptionCombinationItemSchema = z.object({
  name: z.string().min(1),
  value: z.string().min(1),
});

const ProductVariantCreatedSchema = z.object({
  masterId: z.string().min(1),
  versionId: z.string().min(1),
  productName: z.string().min(1),
  variantId: z.string().min(1),
  variantName: z.string().nullable(),
  isDefault: z.boolean(),
  status: z.enum(['active', 'draft', 'archived']),
  inventoryManagement: z.boolean(),
  preStockSellable: z.boolean().optional(),
  alwaysSellableZeroStock: z.boolean().optional(),
  optionCombination: z.array(OptionCombinationItemSchema).optional(),
  createdAt: z.string().datetime(),
});

const ProductVariantUpdatedSchema = z.object({
  masterId: z.string().min(1),
  versionId: z.string().min(1),
  variantId: z.string().min(1),
  variantName: z.string().nullable().optional(),
  status: z.enum(['active', 'draft', 'archived']).optional(),
  updatedAt: z.string().datetime(),
});

const ProductVariantDeletedSchema = z.object({
  masterId: z.string().min(1),
  versionId: z.string().min(1),
  variantId: z.string().min(1),
  deletedAt: z.string().datetime(),
});

const ProductInventoryManagementChangedSchema = z.object({
  masterId: z.string().min(1),
  versionId: z.string().min(1),
  productName: z.string().min(1),
  inventoryManagement: z.boolean(),
  affectedVariants: z.array(
    z.object({
      variantId: z.string().min(1),
      variantName: z.string().nullable(),
    }),
  ),
  changedAt: z.string().datetime(),
});

const ProductSnapshotImageSchema = z.object({
  fileId: z.string(),
  url: z.string(),
  isPrimary: z.boolean(),
  sortOrder: z.number(),
});

const ProductSnapshotCategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  path: z.string(),
  parentId: z.string().nullable(),
  isActive: z.boolean(),
  visibility: z.boolean(),
  showOnMainCategory: z.boolean(),
  thumbnail: z.string().optional(),
});

const ProductSnapshotOptionValueSchema = z.object({
  id: z.string(),
  name: z.string(),
  colorCode: z.string().optional(),
  imageUrl: z.string().optional(),
});

const ProductSnapshotOptionGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  values: z.array(ProductSnapshotOptionValueSchema),
});

const ProductSnapshotVariantSchema = z.object({
  id: z.string(),
  variantName: z.string(),
  sku: z.string(),
  variantCode: z.string().optional(),
  isDefault: z.boolean(),
  status: z.string(),
  optionCombination: z.array(OptionCombinationItemSchema).optional(),
  basePrice: z.number(),
  membershipPrice: z.number().optional(),
  tieredPrices: z.array(z.object({
    minQuantity: z.number(),
    price: z.number(),
  })).optional(),
  weight: z.number().optional(),
  length: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  originCountry: z.string().optional(),
  midCode: z.string().optional(),
  hsCode: z.string().optional(),
  material: z.string().optional(),
});

const ProductPurchaseConstraintSnapshotSchema = z.object({
  requiresMembership: z.boolean(),
  lifetimeQuantityLimit: z.number().int().positive().nullable(),
});

const ProductSnapshotSchema = z.object({
  masterId: z.string(),
  versionId: z.string(),
  version: z.number(),
  name: z.string(),
  description: z.string().optional(),
  descriptionHtml: z.string().optional(),
  thumbnail: z.string().optional(),
  images: z.array(ProductSnapshotImageSchema).optional(),
  seoTitle: z.string().optional(),
  seoDescription: z.string().optional(),
  seoKeywords: z.string().optional(),
  categories: z.array(ProductSnapshotCategorySchema).optional(),
  brand: z.string().optional(),
  tags: z.array(z.string()).optional(),
  productType: z.string().optional(),
  fulfillmentKind: z.enum(['physical', 'digital']).optional(),
  optionGroups: z.array(ProductSnapshotOptionGroupSchema).optional(),
  variants: z.array(ProductSnapshotVariantSchema),
  status: z.enum(['active', 'draft', 'archived']),
  isWholesaleOnly: z.boolean(),
  // 멤버십가 공개 제한 (비회원에게 멤버십가 숨김) — 상품 노출/구매 제한 아님
  isMembershipOnly: z.boolean(),
  isGiftcard: z.boolean(),
  discountable: z.boolean(),
  purchaseConstraint: ProductPurchaseConstraintSnapshotSchema.optional(),
});

const ProductMasterActiveVersionChangedSchema = z.object({
  masterId: z.string().min(1),
  versionId: z.string().nullable(),
  name: z.string().nullable(),
  previousActiveVersionId: z.string().nullable(),
  categoryIds: z.array(z.string().min(1)).optional(),
  primaryCategoryId: z.string().nullable().optional(),
  changeReason: z.enum(['published', 'unpublished', 'rollback']),
  changedAt: z.string().datetime(),
  snapshot: ProductSnapshotSchema.nullable().optional(),
});

const ProductMasterDeletedSchema = z.object({
  masterId: z.string().min(1),
  deletedAt: z.string().datetime(),
});

const CategorySnapshotSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().nullable(),
  parentId: z.string().uuid().nullable(),
  level: z.number().int().min(0),
  path: z.string().min(1),
  sortOrder: z.number().int().min(0),
  isActive: z.boolean(),
  visibility: z.boolean(),
  thumbnail: z.string().nullable(),
  displaySettings: z.record(z.string(), z.any()).nullable(),
  seoConfig: z.record(z.string(), z.any()).nullable(),
  templateConfig: z.record(z.string(), z.any()).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const CategoryChangedSchema = z.object({
  categoryId: z.string().uuid(),
  changeType: z.enum(['created', 'updated', 'deleted', 'moved']),
  timestamp: z.string().datetime(),
  category: CategorySnapshotSchema.nullable(),
});

// ===== Stream Config =====

export const PRODUCT_STREAM = stream({
  topic: 'products.events.v1',
  partitions: 12, // masterId 기준 파티셔닝
  aggregateType: 'Product',
  events: {
    ProductVariantCreated: event<'ProductVariantCreated', ProductVariantCreatedPayload>(
      'ProductVariantCreated',
      ProductVariantCreatedSchema,
    ),
    ProductVariantUpdated: event<'ProductVariantUpdated', ProductVariantUpdatedPayload>(
      'ProductVariantUpdated',
      ProductVariantUpdatedSchema,
    ),
    ProductVariantDeleted: event<'ProductVariantDeleted', ProductVariantDeletedPayload>(
      'ProductVariantDeleted',
      ProductVariantDeletedSchema,
    ),
    ProductInventoryManagementChanged: event<
      'ProductInventoryManagementChanged',
      ProductInventoryManagementChangedPayload
    >('ProductInventoryManagementChanged', ProductInventoryManagementChangedSchema),
    ProductMasterActiveVersionChanged: event<
      'ProductMasterActiveVersionChanged',
      ProductMasterActiveVersionChangedPayload
    >('ProductMasterActiveVersionChanged', ProductMasterActiveVersionChangedSchema),
    ProductMasterDeleted: event<'ProductMasterDeleted', ProductMasterDeletedPayload>(
      'ProductMasterDeleted',
      ProductMasterDeletedSchema,
    ),
    CategoryChanged: event<'CategoryChanged', CategoryChangedPayload>(
      'CategoryChanged',
      CategoryChangedSchema,
    ),
  },
});

// ===== 타입 추론 =====

export type ProductEvents = typeof PRODUCT_STREAM.events;
