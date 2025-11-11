/**
 * Product Domain Stream Configuration
 *
 * PIM 상품 도메인 이벤트 스트림 정의
 */

import { event, stream } from '../types';
import { z } from 'zod';

// ===== Payload 타입 정의 =====

export interface ProductVariantCreatedPayload {
  productId: string;
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
  productId: string;
  variantId: string;
  variantName?: string | null;
  status?: 'active' | 'draft' | 'archived';
  updatedAt: string;
}

export interface ProductVariantDeletedPayload {
  productId: string;
  variantId: string;
  deletedAt: string;
}

export interface ProductInventoryManagementChangedPayload {
  productId: string;
  productName: string;
  inventoryManagement: boolean;
  affectedVariants: Array<{
    variantId: string;
    variantName: string | null;
  }>;
  changedAt: string;
}

// ===== Zod 스키마 정의 =====

const OptionCombinationItemSchema = z.object({
  name: z.string().min(1),
  value: z.string().min(1),
});

const ProductVariantCreatedSchema = z.object({
  productId: z.string().min(1),
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
  productId: z.string().min(1),
  variantId: z.string().min(1),
  variantName: z.string().nullable().optional(),
  status: z.enum(['active', 'draft', 'archived']).optional(),
  updatedAt: z.string().datetime(),
});

const ProductVariantDeletedSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().min(1),
  deletedAt: z.string().datetime(),
});

const ProductInventoryManagementChangedSchema = z.object({
  productId: z.string().min(1),
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

// ===== Stream Config =====

export const PRODUCT_STREAM = stream({
  topic: 'products.events.v1',
  partitions: 12, // productId 기준 파티셔닝
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
  },
});

// ===== 타입 추론 =====

export type ProductEvents = typeof PRODUCT_STREAM.events;

