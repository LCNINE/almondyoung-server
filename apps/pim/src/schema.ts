// PIM 마이크로서비스의 전체 스키마 정의
import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  bigint,
  uniqueIndex,
  index,
  foreignKey,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { eq, sql } from 'drizzle-orm';

import { relations } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

// ===== CATEGORY JSONB TYPE DEFINITIONS =====
export type CategoryDisplaySettings = {
  showOnMainCategory?: boolean;
  pcAndMobile?: boolean;
  mobileOnly?: boolean;
  productDisplayOrder?: 'asc' | 'desc';
  defaultSortField?: string;
  menuPositions?: {
    leftSide?: boolean;
    topMenu?: boolean;
    footerMenu?: boolean;
  };
};

export type CategorySeoConfig = {
  browserTitle?: string;
  metaAuthor?: string;
  metaDescription?: string;
  metaKeywords?: string[];
  showInSearchEngines?: boolean;
};

export type CategoryTemplateConfig = {
  templateType?: 'default' | 'custom';
  htmlContent?: string;
  customCss?: string;
};

// ===== 1. PRODUCT CATEGORIES =====
export const productCategories = pgTable(
  'product_categories',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    slug: varchar('slug', { length: 255 }).notNull().unique(),
    imageUrl: text('image_url'), // 카테고리 이미지 URL
    parentId: uuid('parent_id'),
    level: integer('level').notNull().default(0),
    path: varchar('path', { length: 1000 }).notNull().default(''),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),

    // ===== Phase 2 NEW FIELDS START =====
    visibility: boolean('visibility').notNull().default(true),
    displaySettings: jsonb('display_settings').$type<CategoryDisplaySettings>(),
    seoConfig: jsonb('seo_config').$type<CategorySeoConfig>(),
    templateConfig: jsonb('template_config').$type<CategoryTemplateConfig>(),
    // ===== Phase 2 NEW FIELDS END =====

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
  },
  (table) => [
    index('idx_categories_parent_id').on(table.parentId),
    index('idx_categories_level').on(table.level),
    index('idx_categories_path').on(table.path),
    index('idx_categories_slug').on(table.slug),
    index('idx_categories_active').on(table.isActive),
    index('idx_categories_sort_order').on(table.parentId, table.sortOrder),
    uniqueIndex('unique_categories_parent_name').on(table.parentId, table.name),
    // 자기 참조 foreign key 제약 조건
    foreignKey({
      columns: [table.parentId],
      foreignColumns: [table.id],
    }),
  ],
);

// ===== 2. PRODUCT MASTERS (판매상품 마스터) =====
export const productMasters = pgTable(
  'product_masters',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),

    // ===== VERSION MANAGEMENT FIELDS START =====
    masterId: uuid('master_id').notNull(),
    version: integer('version').notNull().default(1),
    parentVersionId: uuid('parent_version_id'),
    versionStatus: varchar('version_status', { length: 20 })
      .notNull()
      .default('draft'), // 'draft' | 'inactive' | 'active'
    draftOwnerId: uuid('draft_owner_id'),
    // ===== VERSION MANAGEMENT FIELDS END =====

    name: varchar('name', { length: 255 }).notNull().default('새 상품'),
    description: text('description'),
    brand: varchar('brand', { length: 100 }),
    thumbnail: text('thumbnail'), // 썸네일 이미지 URL
    // categoryId removed - now using many-to-many relationship via productMasterCategories
    // basePrice removed - 가격은 전적으로 pricing rules로 결정
    // 물리적 속성 제거: weight, dimensions, costPrice 등
    tags: text('tags').array(), // 마케팅 태그
    images: jsonb('images'), // 상품 이미지 (string[])
    attributes: jsonb('attributes'), // 판매 관련 속성 (색상, 소재, 용량 등의 표시용 정보)
    seoTitle: varchar('seo_title', { length: 255 }), // SEO 제목
    seoDescription: text('seo_description'), // SEO 설명
    seoKeywords: text('seo_keywords').array(), // SEO 키워드
    // 고지훈 임시 시연용수정 - 상품 상세설명 (HTML 에디터용)
    descriptionHtml: text('description_html'), // 상품 상세설명 HTML (단일 필드)
    status: varchar('status', { length: 20 }).default('active'), // active, inactive, draft
    // 구매제한 관련 필드들
    isWholesaleOnly: boolean('is_wholesale_only').default(false), // 도매회원 전용
    isMembershipOnly: boolean('is_membership_only').default(false), // 멤버십회원 전용

    // ===== Phase 1 NEW FIELDS START =====
    // Product Type
    productType: varchar('product_type', { length: 50 })
      .notNull()
      .default('regular_sale'), // 'limited_edition' | 'regular_sale'

    // Product Identification
    productCode: varchar('product_code', { length: 100 }).unique(),
    alternativeName: varchar('alternative_name', { length: 255 }),
    material: text('material'),

    // Classification
    salesClassification: varchar('sales_classification', { length: 100 }),
    purchaseClassification: varchar('purchase_classification', { length: 100 }),

    // Shipping
    shippingMethodId: uuid('shipping_method_id'),

    // Pricing (additional)
    marketPrice: bigint('market_price', { mode: 'number' }),
    supplyPrice: bigint('supply_price', { mode: 'number' }),
    supplierId: uuid('supplier_id'),

    // Purchase Restrictions
    ageRestriction: integer('age_restriction').default(0),
    minQuantity: integer('min_quantity').default(1),
    maxQuantity: integer('max_quantity'),

    // Sales Period
    salesStartDate: timestamp('sales_start_date'),
    salesEndDate: timestamp('sales_end_date'),

    // Approval Workflow
    approvalStatus: varchar('approval_status', { length: 20 })
      .notNull()
      .default('draft'), // 'draft', 'pending', 'approved', 'rejected'
    approvedAt: timestamp('approved_at'),
    approvedBy: uuid('approved_by'),
    rejectionReason: text('rejection_reason'),

    // Soft Delete
    deletedAt: timestamp('deleted_at'),
    deletedBy: uuid('deleted_by'),

    // Audit Fields
    seller: varchar('seller', { length: 100 }),
    registrationDate: timestamp('registration_date').defaultNow(),
    lastEditDate: timestamp('last_edit_date'),
    // ===== Phase 1 NEW FIELDS END =====

    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
  },
  (table) => [
    index('idx_masters_status').on(table.status),
    index('idx_masters_name').on(table.name),
    index('idx_masters_brand').on(table.brand),
    index('idx_masters_created_at').on(table.createdAt),
    // Phase 1 new indexes
    index('idx_masters_product_type').on(table.productType),
    index('idx_masters_product_code').on(table.productCode),
    index('idx_masters_approval_status').on(table.approvalStatus),
    index('idx_masters_deleted_at').on(table.deletedAt),
    index('idx_masters_supplier').on(table.supplierId),
    index('idx_masters_sales_dates').on(table.salesStartDate, table.salesEndDate),
    // Version management indexes
    index('idx_masters_master_id').on(table.masterId),
    index('idx_masters_version_status').on(table.versionStatus),
    index('idx_masters_master_id_version').on(table.masterId, table.version),
    uniqueIndex('unique_master_active_version')
      .on(table.masterId)
      .where(sql`${table.versionStatus} = 'active'`),
    uniqueIndex('unique_master_version').on(table.masterId, table.version),
    // Self-referencing foreign key for parent version
    foreignKey({
      columns: [table.parentVersionId],
      foreignColumns: [table.id],
    }),
  ],
);

// ===== 2.1. PRODUCT MASTER CATEGORIES (Many-to-Many Junction Table) =====
export const productMasterCategories = pgTable(
  'product_master_categories',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    masterId: uuid('master_id')
      .notNull()
      .references(() => productMasters.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => productCategories.id, { onDelete: 'cascade' }),
    isPrimary: boolean('is_primary').default(false), // 주 카테고리 여부
    createdAt: timestamp('created_at').defaultNow(),
    createdBy: uuid('created_by'),
  },
  (table) => [
    index('idx_master_categories_master').on(table.masterId),
    index('idx_master_categories_category').on(table.categoryId),
    index('idx_master_categories_primary').on(table.masterId, table.isPrimary),
    uniqueIndex('unique_master_category').on(table.masterId, table.categoryId),
  ],
);

// ===== 2.2. PRODUCT MASTER OPTION GROUPS (Mapping Table) =====
export const productMasterOptionGroups = pgTable(
  'product_master_option_groups',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    masterId: uuid('master_id').notNull(),
    optionGroupId: uuid('option_group_id')
      .notNull()
      .references(() => productOptionGroups.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => [
    index('idx_master_option_groups_master_version').on(
      table.masterId,
      table.version,
    ),
    uniqueIndex('unique_master_option_group_version').on(
      table.masterId,
      table.optionGroupId,
      table.version,
    ),
  ],
);

// ===== 2.3. PRODUCT MASTER VARIANTS (Mapping Table) =====
export const productMasterVariants = pgTable(
  'product_master_variants',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    masterId: uuid('master_id').notNull(),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => [
    index('idx_master_variants_master_version').on(
      table.masterId,
      table.version,
    ),
    uniqueIndex('unique_master_variant_version').on(
      table.masterId,
      table.variantId,
      table.version,
    ),
  ],
);

// ===== 2.4. PRODUCT MASTER PRICING RULES (Mapping Table) =====
export const productMasterPricingRules = pgTable(
  'product_master_pricing_rules',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    masterId: uuid('master_id').notNull(),
    pricingRuleId: uuid('pricing_rule_id')
      .notNull()
      .references(() => pricingRules.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => [
    index('idx_master_pricing_rules_master_version').on(
      table.masterId,
      table.version,
    ),
    uniqueIndex('unique_master_pricing_rule_version').on(
      table.masterId,
      table.pricingRuleId,
      table.version,
    ),
  ],
);

// ===== 2.5. PRODUCT OPTION GROUP DISPLAYS (버전별/언어별 표시 정보) =====
export const productOptionGroupDisplays = pgTable(
  'product_option_group_displays',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    optionGroupId: uuid('option_group_id')
      .notNull()
      .references(() => productOptionGroups.id, { onDelete: 'cascade' }),
    masterId: uuid('master_id').notNull(),
    version: integer('version').notNull(),
    locale: varchar('locale', { length: 10 }).notNull().default('ko-KR'),
    displayName: varchar('display_name', { length: 100 }).notNull(),
    description: text('description'),
    sortOrder: integer('sort_order').default(0),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => [
    index('idx_option_group_displays_lookup').on(
      table.optionGroupId,
      table.masterId,
      table.version,
      table.locale,
    ),
    uniqueIndex('unique_option_group_display').on(
      table.optionGroupId,
      table.masterId,
      table.version,
      table.locale,
    ),
  ],
);

// ===== 2.6. PRODUCT OPTION VALUE DISPLAYS (버전별/언어별 표시 정보) =====
export const productOptionValueDisplays = pgTable(
  'product_option_value_displays',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    optionValueId: uuid('option_value_id')
      .notNull()
      .references(() => productOptionValues.id, { onDelete: 'cascade' }),
    masterId: uuid('master_id').notNull(),
    version: integer('version').notNull(),
    locale: varchar('locale', { length: 10 }).notNull().default('ko-KR'),
    displayName: varchar('display_name', { length: 100 }).notNull(),
    colorCode: varchar('color_code', { length: 7 }),
    imageUrl: text('image_url'),
    sortOrder: integer('sort_order').default(0),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => [
    index('idx_option_value_displays_lookup').on(
      table.optionValueId,
      table.masterId,
      table.version,
      table.locale,
    ),
    uniqueIndex('unique_option_value_display').on(
      table.optionValueId,
      table.masterId,
      table.version,
      table.locale,
    ),
  ],
);

// ===== 3. PRODUCT OPTION GROUPS =====
export const productOptionGroups = pgTable(
  'product_option_groups',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    createdAt: timestamp('created_at').defaultNow(),
  },
);

// ===== 4. PRODUCT OPTION VALUES =====
export const productOptionValues = pgTable(
  'product_option_values',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    optionGroupId: uuid('option_group_id')
      .notNull()
      .references(() => productOptionGroups.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => [
    index('idx_option_values_group').on(table.optionGroupId),
  ],
);

// ===== 5. PRODUCT VARIANTS (판매상품 품목) =====
export const productVariants = pgTable(
  'product_variants',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    variantName: varchar('variant_name', { length: 255 }), // 수동 설정 이름
    images: jsonb('images'), // string[] - 품목별 이미지
    priceAdjustment: bigint('price_adjustment', { mode: 'number' }).default(0), // 기준가 대비 조정 (원 단위)
    // 물리적 속성 제거: weightAdjustment 등
    displayOrder: integer('display_order').default(0), // 표시 순서
    status: varchar('status', { length: 20 }).default('active'), // active, inactive
    isDefault: boolean('is_default').default(false), // 옵션 없는 경우의 기본 품목

    // Phase 1 new fields
    variantCode: varchar('variant_code', { length: 100 }).unique(),
    variantImages: jsonb('variant_images').$type<string[]>(),

    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    index('idx_variants_status').on(table.status),
    index('idx_variants_is_default').on(table.isDefault),
    index('idx_variants_created_at').on(table.createdAt),
    index('idx_variants_code').on(table.variantCode),
  ],
);

// ===== 6. VARIANT OPTION VALUES (다대다 매핑) =====
export const variantOptionValues = pgTable(
  'variant_option_values',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    optionValueId: uuid('option_value_id')
      .notNull()
      .references(() => productOptionValues.id, { onDelete: 'cascade' }),
  },
  (table) => [
    index('idx_variant_options_variant').on(table.variantId),
    index('idx_variant_options_value').on(table.optionValueId),
    uniqueIndex('unique_variant_option_values').on(
      table.variantId,
      table.optionValueId,
    ),
  ],
);

// ===== 7. CHANNEL CATEGORIES =====
export const channelCategories = pgTable(
  'channel_categories',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    name: varchar('name', { length: 100 }).notNull(),
    description: text('description'),
    displayOrder: integer('display_order').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_channel_categories_order').on(table.displayOrder),
  ],
);

// ===== 8. SALES CHANNELS =====
export const salesChannels = pgTable(
  'sales_channels',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    type: varchar('type', { length: 50 }).notNull().default('ONLINE'),
    site: varchar('site', { length: 50 }).notNull(),
    categoryId: uuid('category_id').references(() => channelCategories.id, { onDelete: 'set null' }),
    name: varchar('name', { length: 100 }).notNull(),
    isActive: boolean('is_active').default(true),
    apiConfig: jsonb('api_config'),
    supportedFeatures: jsonb('supported_features'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    index('idx_sales_channels_type').on(table.type),
    index('idx_sales_channels_site').on(table.site),
    index('idx_sales_channels_category').on(table.categoryId),
    index('idx_sales_channels_active').on(table.isActive),
  ],
);

// ===== 9. CHANNEL PRODUCTS =====
export const channelProducts = pgTable(
  'channel_products',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    masterId: uuid('master_id')
      .notNull()
      .references(() => productMasters.id, { onDelete: 'cascade' }),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => salesChannels.id, { onDelete: 'cascade' }),

    // 오버라이드 가능한 필드들 (판매 여부, 상품명만)
    name: varchar('name', { length: 255 }), // 상품명 오버라이드
    isActive: boolean('is_active').default(true), // 판매 여부

    // 채널별 특수 설정
    channelSpecificData: jsonb('channel_specific_data'),

    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    index('idx_channel_products_master').on(table.masterId),
    index('idx_channel_products_channel').on(table.channelId),
    index('idx_channel_products_active').on(table.isActive),
    uniqueIndex('unique_master_channel').on(table.masterId, table.channelId),
  ],
);

// ===== 10. PRICING RULES (규칙 기반 가격 정책) =====
export const pricingRules = pgTable(
  'pricing_rules',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    layer: varchar('layer', { length: 20 }).notNull(), // 'base_price', 'membership_price', 'tiered_price'
    order: integer('order').notNull(), // 레이어 내 순서 (1부터 시작)
    scopeType: varchar('scope_type', { length: 20 }).notNull(), // 'all_variants', 'with_option', 'variants'
    scopeTargetIds: uuid('scope_target_ids').array(), // option_value_ids 또는 variant_ids
    operationType: varchar('operation_type', { length: 20 }).notNull(), // 'offset', 'scale', 'override'
    operationValue: bigint('operation_value', { mode: 'number' }).notNull(), // 원 단위 (scale은 1000배)
    minQuantity: integer('min_quantity'), // tiered_price 레이어에서만 사용
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
);

// ===== 13. UPLOADS (파일 업로드) =====
export const uploads = pgTable(
  'uploads',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    fileName: varchar('file_name', { length: 255 }).notNull(),
    originalName: varchar('original_name', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 100 }).notNull(),
    filePath: text('file_path').notNull(), // 실제 파일 저장 경로
    url: text('url').notNull(), // 접근 가능한 URL
    size: integer('size'), // 파일 사이즈 (bytes)
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => [
    index('idx_uploads_created_at').on(table.createdAt),
    index('idx_uploads_mime_type').on(table.mimeType),
  ],
);

// ===== 12. PRODUCT IMAGES (상품 이미지) =====
export const productImages = pgTable(
  'product_images',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    masterId: uuid('master_id')
      .notNull()
      .references(() => productMasters.id, { onDelete: 'cascade' }),
    uploadId: uuid('upload_id')
      .notNull()
      .references(() => uploads.id, { onDelete: 'cascade' }),
    isPrimary: boolean('is_primary').default(false), // 대표이미지 여부
    sortOrder: integer('sort_order').default(0), // 부가이미지 순서 (1-5)
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => [
    index('idx_product_images_master').on(table.masterId),
    index('idx_product_images_primary').on(table.masterId, table.isPrimary),
    index('idx_product_images_sort').on(table.masterId, table.sortOrder),
    uniqueIndex('unique_product_primary_image')
      .on(table.masterId)
      .where(sql`${table.isPrimary} = true`),
  ],
);

// ===== 13. PRODUCT APPROVAL HISTORY =====
export const productApprovalHistory = pgTable(
  'product_approval_history',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    productId: uuid('product_id')
      .notNull()
      .references(() => productMasters.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 20 }).notNull(), // 'pending', 'approved', 'rejected'
    comment: text('comment'),
    approvedBy: uuid('approved_by').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_approval_history_product').on(table.productId),
    index('idx_approval_history_status').on(table.status),
    index('idx_approval_history_date').on(table.createdAt),
  ],
);

// ===== 14. PRODUCT AUDIT LOG =====
export const productAuditLog = pgTable(
  'product_audit_log',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    productId: uuid('product_id').notNull(),
    action: varchar('action', { length: 50 }).notNull(), // 'created', 'updated', 'deleted', 'restored'
    changes: jsonb('changes').$type<Record<string, any>>(),
    userId: uuid('user_id').notNull(),
    userEmail: varchar('user_email', { length: 255 }),
    timestamp: timestamp('timestamp').notNull().defaultNow(),
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: text('user_agent'),
  },
  (table) => [
    index('idx_audit_log_product').on(table.productId),
    index('idx_audit_log_action').on(table.action),
    index('idx_audit_log_timestamp').on(table.timestamp),
    index('idx_audit_log_user').on(table.userId),
  ],
);

// 추후 타임세일 구현을 위한 스키마. 10월 1일 이후 구현 예정 (혹은 메두사에 책임 이관)
export const promotions = pgTable('promotions', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7()),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  startAt: timestamp('start_at').notNull(),
  endAt: timestamp('end_at').notNull(),
  discountType: varchar('discount_type', { length: 20 }).notNull(), // 'percentage' | 'fixed'
  discountValue: integer('discount_value').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const promotionProducts = pgTable('promotion_products', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7()),
  promotionId: uuid('promotion_id')
    .notNull()
    .references(() => promotions.id, { onDelete: 'cascade' }),
  masterId: uuid('master_id')
    .notNull()
    .references(() => productMasters.id, { onDelete: 'cascade' }),
  variantId: uuid('variant_id').references(() => productVariants.id),
});

// ===== 15. TAG GROUPS =====
export const tagGroups = pgTable(
  'tag_groups',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    name: varchar('name', { length: 100 }).notNull(),
    description: text('description'),
    displayOrder: integer('display_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_tag_groups_active').on(table.isActive),
    index('idx_tag_groups_display_order').on(table.displayOrder),
  ],
);

// ===== 16. TAG VALUES =====
export const tagValues = pgTable(
  'tag_values',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    groupId: uuid('group_id')
      .notNull()
      .references(() => tagGroups.id, { onDelete: 'restrict' }),
    name: varchar('name', { length: 100 }).notNull(),
    displayOrder: integer('display_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_tag_values_group_id').on(table.groupId),
    index('idx_tag_values_active').on(table.isActive),
    index('idx_tag_values_display_order').on(table.groupId, table.displayOrder),
    uniqueIndex('unique_tag_values_group_name').on(table.groupId, table.name),
  ],
);

// ===== 17. CATEGORY TAG GROUPS (Category ↔ Tag Group 연결) =====
export const categoryTagGroups = pgTable(
  'category_tag_groups',
  {
    categoryId: uuid('category_id')
      .notNull()
      .references(() => productCategories.id, { onDelete: 'cascade' }),
    tagGroupId: uuid('tag_group_id')
      .notNull()
      .references(() => tagGroups.id, { onDelete: 'restrict' }),
    displayOrder: integer('display_order').notNull().default(0),
    isRequired: boolean('is_required').notNull().default(false),
    appliesToDescendants: boolean('applies_to_descendants').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.categoryId, table.tagGroupId] }),
    index('idx_category_tag_groups_category').on(table.categoryId),
    index('idx_category_tag_groups_group').on(table.tagGroupId),
    index('idx_category_tag_groups_display_order').on(table.categoryId, table.displayOrder),
  ],
);

// ===== 18. PRODUCT TAG VALUES (Product ↔ Tag Value 연결) =====
export const productTagValues = pgTable(
  'product_tag_values',
  {
    masterId: uuid('master_id').notNull(),
    version: integer('version').notNull(),
    tagValueId: uuid('tag_value_id')
      .notNull()
      .references(() => tagValues.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.masterId, table.version, table.tagValueId] }),
    index('idx_product_tag_values_master_version').on(table.masterId, table.version),
    index('idx_product_tag_values_tag').on(table.tagValueId),
  ],
);

// PIM 전체 스키마 통합
export const pimSchema = {
  productCategories,
  productMasters,
  productMasterCategories,
  productMasterOptionGroups,
  productMasterVariants,
  productMasterPricingRules,
  productOptionGroupDisplays,
  productOptionValueDisplays,
  productOptionGroups,
  productOptionValues,
  productVariants,
  variantOptionValues,
  channelCategories,
  salesChannels,
  channelProducts,
  pricingRules,
  uploads,
  productImages,
  productApprovalHistory,
  productAuditLog,
  tagGroups,
  tagValues,
  categoryTagGroups,
  productTagValues,
};

// ===== RELATIONS =====
export const productCategoriesRelations = relations(
  productCategories,
  ({ one, many }) => ({
    parent: one(productCategories, {
      fields: [productCategories.parentId],
      references: [productCategories.id],
    }),
    children: many(productCategories),
    productMasterCategories: many(productMasterCategories),
  }),
);

export const productMastersRelations = relations(
  productMasters,
  ({ many }) => ({
    productMasterCategories: many(productMasterCategories),
  }),
);

export const productMasterCategoriesRelations = relations(
  productMasterCategories,
  ({ one }) => ({
    master: one(productMasters, {
      fields: [productMasterCategories.masterId],
      references: [productMasters.id],
    }),
    category: one(productCategories, {
      fields: [productMasterCategories.categoryId],
      references: [productCategories.id],
    }),
  }),
);

export const channelCategoriesRelations = relations(
  channelCategories,
  ({ many }) => ({
    channels: many(salesChannels),
  }),
);

export const salesChannelsRelations = relations(
  salesChannels,
  ({ one, many }) => ({
    category: one(channelCategories, {
      fields: [salesChannels.categoryId],
      references: [channelCategories.id],
    }),
    channelProducts: many(channelProducts),
  }),
);

export const channelProductsRelations = relations(
  channelProducts,
  ({ one }) => ({
    master: one(productMasters, {
      fields: [channelProducts.masterId],
      references: [productMasters.id],
    }),
    channel: one(salesChannels, {
      fields: [channelProducts.channelId],
      references: [salesChannels.id],
    }),
  }),
);

export const tagGroupsRelations = relations(tagGroups, ({ many }) => ({
  values: many(tagValues),
  categories: many(categoryTagGroups),
}));

export const tagValuesRelations = relations(tagValues, ({ one, many }) => ({
  group: one(tagGroups, {
    fields: [tagValues.groupId],
    references: [tagGroups.id],
  }),
  products: many(productTagValues),
}));

export const categoryTagGroupsRelations = relations(categoryTagGroups, ({ one }) => ({
  category: one(productCategories, {
    fields: [categoryTagGroups.categoryId],
    references: [productCategories.id],
  }),
  tagGroup: one(tagGroups, {
    fields: [categoryTagGroups.tagGroupId],
    references: [tagGroups.id],
  }),
}));

export const productTagValuesRelations = relations(productTagValues, ({ one }) => ({
  tagValue: one(tagValues, {
    fields: [productTagValues.tagValueId],
    references: [tagValues.id],
  }),
}));

// 스키마 타입 추출
export type PimSchema = typeof pimSchema;

// 개별 테이블들은 이미 export const로 선언되어 재export 불필요
