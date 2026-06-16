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
  check,
  foreignKey,
  primaryKey,
  pgEnum,
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
    // 자기 참조 foreign key 제약 조건
    foreignKey({
      columns: [table.parentId],
      foreignColumns: [table.id],
    }),
  ],
);

// ===== 2. PRODUCT MASTERS (판매상품 마스터 메타데이터) =====
export const productMasters = pgTable(
  'product_masters',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    createdBy: uuid('created_by'),
    deletedAt: timestamp('deleted_at'),
    deletedBy: uuid('deleted_by'),
  },
  (table) => [index('idx_masters_created_at').on(table.createdAt), index('idx_masters_deleted_at').on(table.deletedAt)],
);

// ===== 2.1. PRODUCT MASTER VERSIONS (판매상품 버전별 데이터) =====
export const ProductMasterVersionStatusEnum = pgEnum('product_master_version_status', ['draft', 'inactive', 'active']);
export const ProductMasterVersionApprovalStatusEnum = pgEnum('product_master_version_approval_status', [
  'draft',
  'pending',
  'approved',
  'rejected',
]);
export const productMasterVersions = pgTable(
  'product_master_versions',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),

    // ===== VERSION MANAGEMENT FIELDS START =====
    masterId: uuid('master_id')
      .notNull()
      .references(() => productMasters.id, { onDelete: 'cascade' }),
    version: integer('version').notNull().default(1),
    parentVersionId: uuid('parent_version_id'),
    status: ProductMasterVersionStatusEnum('status').notNull().default('draft'), // 'draft' | 'inactive' | 'active'
    draftOwnerId: uuid('draft_owner_id'),
    // ===== VERSION MANAGEMENT FIELDS END =====

    name: varchar('name', { length: 255 }).notNull().default('새 상품'),
    description: text('description'),
    brand: varchar('brand', { length: 100 }),
    thumbnail: text('thumbnail'), // 썸네일 이미지 파일 ID

    seoTitle: varchar('seo_title', { length: 255 }), // SEO 제목
    seoDescription: text('seo_description'), // SEO 설명
    seoKeywords: text('seo_keywords').array(), // SEO 키워드
    // 고지훈 임시 시연용수정 - 상품 상세설명 (HTML 에디터용)
    descriptionHtml: text('description_html'), // 상품 상세설명 HTML (단일 필드)
    isWholesaleOnly: boolean('is_wholesale_only').default(false).notNull(), // 도매회원 전용
    isMembershipOnly: boolean('is_membership_only').default(false).notNull(), // 멤버십가 공개 제한 — 비회원에게 멤버십가 숫자를 숨김 (상품 노출/구매 제한 아님; 구매 제한은 purchaseConstraint 사용)
    hideMembershipPriceForNonMembers: boolean('hide_membership_price_for_non_members').default(false).notNull(), // 멤버십가 공개 제한 canonical field
    isVisibleToMembersOnly: boolean('is_visible_to_members_only').default(false).notNull(), // 멤버십 회원 전용 노출 — 비회원 목록/검색/상세에서 숨김

    // ===== Phase 1 NEW FIELDS START =====
    // Product Type
    productType: varchar('product_type', { length: 50 }).notNull().default('regular_sale'), // 'limited_edition' | 'regular_sale'
    // Fulfillment classification. Shipping eligibility must not be inferred from SKU or asset matching.
    fulfillmentKind: varchar('fulfillment_kind', { length: 20 })
      .$type<'physical' | 'digital'>()
      .notNull()
      .default('physical'),

    // Product Identification
    productCode: varchar('product_code', { length: 100 }),
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
    ageRestriction: integer('age_restriction').default(0).notNull(),
    minQuantity: integer('min_quantity').default(1).notNull(),
    maxQuantity: integer('max_quantity'),

    // Sales Period
    salesStartDate: timestamp('sales_start_date'),
    salesEndDate: timestamp('sales_end_date'),

    // Approval Workflow
    approvalStatus: ProductMasterVersionApprovalStatusEnum('approval_status').notNull().default('draft'), // 'draft', 'pending', 'approved', 'rejected'
    approvedAt: timestamp('approved_at'),
    approvedBy: uuid('approved_by'),
    rejectionReason: text('rejection_reason'),

    // Soft Delete
    deletedAt: timestamp('deleted_at'),
    deletedBy: uuid('deleted_by'),

    // Audit Fields
    seller: varchar('seller', { length: 100 }),
    registrationDate: timestamp('registration_date').defaultNow().notNull(),
    // ===== Phase 1 NEW FIELDS END =====

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
  },
  (table) => [
    // FK constraints
    foreignKey({
      columns: [table.parentVersionId],
      foreignColumns: [table.id],
    }),
    // Indexes
    index('idx_versions_master_id').on(table.masterId),
    index('idx_versions_status').on(table.status),
    index('idx_versions_master_version').on(table.masterId, table.version),
    index('idx_versions_name').on(table.name),
    index('idx_versions_brand').on(table.brand),
    index('idx_versions_created_at').on(table.createdAt),
    index('idx_versions_product_type').on(table.productType),
    index('idx_versions_product_code').on(table.productCode),
    index('idx_versions_approval_status').on(table.approvalStatus),
    index('idx_versions_deleted_at').on(table.deletedAt),
    index('idx_versions_supplier').on(table.supplierId),
    index('idx_versions_sales_dates').on(table.salesStartDate, table.salesEndDate),
    uniqueIndex('unique_master_active_version')
      .on(table.masterId)
      .where(sql`${table.status} = 'active'`),
    uniqueIndex('unique_active_product_code')
      .on(table.productCode)
      .where(sql`${table.status} = 'active'`),
    uniqueIndex('unique_master_version').on(table.masterId, table.version),
  ],
);

// ===== 2.2. PRODUCT MASTER CATEGORIES (Many-to-Many Junction Table) =====
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
    versionId: uuid('version_id')
      .notNull()
      .references(() => productMasterVersions.id, { onDelete: 'cascade' }),
    isPrimary: boolean('is_primary').default(false).notNull(), // 주 카테고리 여부
    createdAt: timestamp('created_at').defaultNow().notNull(),
    createdBy: uuid('created_by'),
  },
  (table) => [
    index('idx_master_categories_master_version').on(table.masterId, table.versionId),
    index('idx_master_categories_category').on(table.categoryId),
    index('idx_master_categories_primary').on(table.masterId, table.isPrimary),
    uniqueIndex('unique_master_category_version').on(table.masterId, table.categoryId, table.versionId),
  ],
);

// ===== 2.3. PRODUCT MASTER OPTION GROUPS (Mapping Table) =====
export const productMasterOptionGroups = pgTable(
  'product_master_option_groups',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    masterId: uuid('master_id')
      .notNull()
      .references(() => productMasters.id, { onDelete: 'cascade' }),
    optionGroupId: uuid('option_group_id')
      .notNull()
      .references(() => productOptionGroups.id, { onDelete: 'cascade' }),
    versionId: uuid('version_id')
      .notNull()
      .references(() => productMasterVersions.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_master_option_groups_master_version').on(table.masterId, table.versionId),
    uniqueIndex('unique_master_option_group_version').on(table.masterId, table.optionGroupId, table.versionId),
  ],
);

// ===== 2.4. PRODUCT MASTER VARIANTS (Mapping Table) =====
export const productMasterVariants = pgTable(
  'product_master_variants',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    masterId: uuid('master_id')
      .notNull()
      .references(() => productMasters.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    versionId: uuid('version_id')
      .notNull()
      .references(() => productMasterVersions.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_master_variants_master_version').on(table.masterId, table.versionId),
    uniqueIndex('unique_master_variant_version').on(table.masterId, table.variantId, table.versionId),
  ],
);

// ===== 2.5. PRODUCT MASTER PRICING RULES (Mapping Table) =====
export const productMasterPricingRules = pgTable(
  'product_master_pricing_rules',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    masterId: uuid('master_id')
      .notNull()
      .references(() => productMasters.id, { onDelete: 'cascade' }),
    pricingRuleId: uuid('pricing_rule_id')
      .notNull()
      .references(() => pricingRules.id, { onDelete: 'cascade' }),
    versionId: uuid('version_id')
      .notNull()
      .references(() => productMasterVersions.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_master_pricing_rules_master_version').on(table.masterId, table.versionId),
    uniqueIndex('unique_master_pricing_rule_version').on(table.masterId, table.pricingRuleId, table.versionId),
  ],
);

export const productPurchaseConstraints = pgTable(
  'product_purchase_constraints',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    requiresMembership: boolean('requires_membership').default(false).notNull(),
    lifetimeQuantityLimit: integer('lifetime_quantity_limit'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    check(
      'chk_product_purchase_constraints_lifetime_quantity_limit_positive',
      sql.raw('"lifetime_quantity_limit" IS NULL OR "lifetime_quantity_limit" > 0'),
    ),
  ],
);

export const productMasterPurchaseConstraints = pgTable(
  'product_master_purchase_constraints',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    masterId: uuid('master_id')
      .notNull()
      .references(() => productMasters.id, { onDelete: 'cascade' }),
    versionId: uuid('version_id')
      .notNull()
      .references(() => productMasterVersions.id, { onDelete: 'cascade' }),
    purchaseConstraintId: uuid('purchase_constraint_id')
      .notNull()
      .references(() => productPurchaseConstraints.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_master_purchase_constraints_master_version').on(table.masterId, table.versionId),
    index('idx_master_purchase_constraints_constraint').on(table.purchaseConstraintId),
    uniqueIndex('unique_purchase_constraint_version').on(table.versionId),
    uniqueIndex('unique_master_purchase_constraint_version').on(table.masterId, table.versionId),
  ],
);

// ===== 2.6. PRODUCT OPTION GROUP DISPLAYS (버전별/언어별 표시 정보) =====
export const productOptionGroupDisplays = pgTable(
  'product_option_group_displays',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    optionGroupId: uuid('option_group_id')
      .notNull()
      .references(() => productOptionGroups.id, { onDelete: 'cascade' }),
    masterId: uuid('master_id')
      .notNull()
      .references(() => productMasters.id, { onDelete: 'cascade' }),
    versionId: uuid('version_id')
      .notNull()
      .references(() => productMasterVersions.id, { onDelete: 'cascade' }),
    locale: varchar('locale', { length: 10 }).notNull().default('ko-KR'),
    displayName: varchar('display_name', { length: 100 }).notNull(),
    description: text('description'),
    sortOrder: integer('sort_order').default(0).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_option_group_displays_lookup').on(table.optionGroupId, table.masterId, table.versionId, table.locale),
    uniqueIndex('unique_option_group_display').on(table.optionGroupId, table.masterId, table.versionId, table.locale),
  ],
);

// ===== 2.7. PRODUCT OPTION VALUE DISPLAYS (버전별/언어별 표시 정보) =====
export const productOptionValueDisplays = pgTable(
  'product_option_value_displays',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    optionValueId: uuid('option_value_id')
      .notNull()
      .references(() => productOptionValues.id, { onDelete: 'cascade' }),
    masterId: uuid('master_id')
      .notNull()
      .references(() => productMasters.id, { onDelete: 'cascade' }),
    versionId: uuid('version_id')
      .notNull()
      .references(() => productMasterVersions.id, { onDelete: 'cascade' }),
    locale: varchar('locale', { length: 10 }).notNull().default('ko-KR'),
    displayName: varchar('display_name', { length: 100 }).notNull(),
    colorCode: varchar('color_code', { length: 7 }),
    imageUrl: text('image_url'),
    sortOrder: integer('sort_order').default(0).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_option_value_displays_lookup').on(table.optionValueId, table.masterId, table.versionId, table.locale),
    uniqueIndex('unique_option_value_display').on(table.optionValueId, table.masterId, table.versionId, table.locale),
  ],
);

// ===== 3. PRODUCT OPTION GROUPS =====
export const productOptionGroups = pgTable('product_option_groups', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7()),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

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
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_option_values_group').on(table.optionGroupId)],
);

// ===== 5. PRODUCT VARIANTS (판매상품 품목) =====
export const productVariants = pgTable(
  'product_variants',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    variantName: varchar('variant_name', { length: 255 }), // 수동 설정 이름
    imageId: uuid('image_id'), // 품목별 이미지 파일 ID

    displayOrder: integer('display_order').default(0).notNull(), // 표시 순서
    status: varchar('status', { length: 20 }).notNull().default('active'), // active, inactive
    isDefault: boolean('is_default').default(false).notNull(), // 옵션 없는 경우의 기본 품목

    // Phase 1 new fields
    // variantCode 는 외부 식별자(채널 어댑터에서 Medusa barcode 로 매핑)이고, 같은 master 의
    // active variant 와 draft variant 가 같은 물리적 상품을 가리키므로 의도적으로 코드를 공유한다.
    // "현재 active 버전에 매달린 variant 끼리만 unique" 는 정션 join 이 필요해 partial index 로
    // 표현 불가 — 따라서 DB 강제는 없고, publishVersion 이 publish 직전에 검증한다.
    // 자세한 결정은 docs/adr/0004-variant-draft-scoped-edit-cow.md.
    variantCode: varchar('variant_code', { length: 100 }),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
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
    uniqueIndex('unique_variant_option_values').on(table.variantId, table.optionValueId),
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
  (table) => [index('idx_channel_categories_order').on(table.displayOrder)],
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
    description: text('description'),
    config: jsonb('config').$type<Record<string, any>>(),
    isActive: boolean('is_active').default(true).notNull(),
    apiEndpoint: varchar('api_endpoint', { length: 500 }),
    credentials: jsonb('credentials').$type<Record<string, any>>(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
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
    isActive: boolean('is_active').default(true).notNull(), // 판매 여부

    // 채널별 특수 설정
    channelSpecificData: jsonb('channel_specific_data').$type<Record<string, any>>(),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_channel_products_master').on(table.masterId),
    index('idx_channel_products_channel').on(table.channelId),
    index('idx_channel_products_active').on(table.isActive),
    uniqueIndex('unique_master_channel').on(table.masterId, table.channelId),
  ],
);

// ===== 10. PRICING RULES (규칙 기반 가격 정책) =====
export const pricingRuleLayerEnum = pgEnum('pricing_rule_layer', ['base_price', 'membership_price', 'tiered_price']);
export const pricingRuleScopeTypeEnum = pgEnum('pricing_rule_scope_type', ['all_variants', 'with_option', 'variants']);
export const pricingRuleOperationTypeEnum = pgEnum('pricing_rule_operation_type', ['offset', 'scale', 'override']);
export const pricingRules = pgTable('pricing_rules', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7()),
  layer: pricingRuleLayerEnum('layer').notNull(), // 'base_price', 'membership_price', 'tiered_price'
  order: integer('order').notNull(), // 레이어 내 순서 (1부터 시작)
  scopeType: pricingRuleScopeTypeEnum('scope_type').notNull(), // 'all_variants', 'with_option', 'variants'
  scopeTargetIds: uuid('scope_target_ids').array(), // option_value_ids 또는 variant_ids
  operationType: pricingRuleOperationTypeEnum('operation_type').notNull(), // 'offset', 'scale', 'override'
  operationValue: bigint('operation_value', { mode: 'number' }).notNull(), // 원 단위 (scale은 1000배)
  minQuantity: integer('min_quantity'), // tiered_price 레이어에서만 사용
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ===== 11. PRODUCT VARIANT PRICE CACHE (버전별 가격 캐시) =====
export const productVariantPriceCache = pgTable(
  'product_variant_price_cache',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    versionId: uuid('version_id')
      .notNull()
      .references(() => productMasterVersions.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    basePrice: bigint('base_price', { mode: 'number' }).notNull(),
    membershipPrice: bigint('membership_price', { mode: 'number' }).notNull(),
    tieredPrices: jsonb('tiered_prices')
      .$type<Array<{ minQuantity: number; price: number }>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_variant_price_cache_version').on(table.versionId),
    index('idx_variant_price_cache_variant').on(table.variantId),
    uniqueIndex('unique_variant_price_cache_version_variant').on(table.versionId, table.variantId),
  ],
);

// ===== 12. PRODUCT IMAGES (상품 이미지) =====
export const productImages = pgTable(
  'product_images',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    versionId: uuid('version_id')
      .notNull()
      .references(() => productMasterVersions.id, { onDelete: 'cascade' }),
    fileId: uuid('file_id').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false), // 대표이미지 여부
    sortOrder: integer('sort_order').notNull().default(0), // 부가이미지 순서 (1-5)
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_product_images_version').on(table.versionId),
    index('idx_product_images_primary').on(table.versionId, table.isPrimary),
    index('idx_product_images_sort').on(table.versionId, table.sortOrder),
    uniqueIndex('unique_product_primary_image')
      .on(table.versionId)
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
    versionId: uuid('version_id')
      .notNull()
      .references(() => productMasterVersions.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 20 }).notNull(), // 'pending', 'approved', 'rejected'
    comment: text('comment'),
    approvedBy: uuid('approved_by').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_approval_history_version').on(table.versionId),
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
    versionId: uuid('version_id').notNull(),
    action: varchar('action', { length: 50 }).notNull(), // 'created', 'updated', 'deleted', 'restored'
    changes: jsonb('changes').$type<Record<string, any>>(),
    userId: uuid('user_id').notNull(),
    userEmail: varchar('user_email', { length: 255 }),
    timestamp: timestamp('timestamp').defaultNow().notNull(),
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: text('user_agent'),
  },
  (table) => [
    index('idx_audit_log_version').on(table.versionId),
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
  createdAt: timestamp('created_at').defaultNow().notNull(),
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
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
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
    masterId: uuid('master_id')
      .notNull()
      .references(() => productMasters.id, { onDelete: 'cascade' }),
    versionId: uuid('version_id')
      .notNull()
      .references(() => productMasterVersions.id, { onDelete: 'cascade' }),
    tagValueId: uuid('tag_value_id')
      .notNull()
      .references(() => tagValues.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.masterId, table.versionId, table.tagValueId] }),
    index('idx_product_tag_values_master_version').on(table.masterId, table.versionId),
    index('idx_product_tag_values_tag').on(table.tagValueId),
  ],
);

// ===== 19. CHANNEL VARIANT LISTINGS (채널 상품 ↔ Variant 매핑) =====
export const channelVariantListings = pgTable(
  'channel_variant_listings',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),

    // 어떤 variant가
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),

    // 어떤 채널에
    salesChannelId: uuid('sales_channel_id')
      .notNull()
      .references(() => salesChannels.id, { onDelete: 'cascade' }),

    // 어떤 ID로 등록되어 있는가
    channelItemId: varchar('channel_item_id', { length: 255 }).notNull(),

    // 채널에서의 부가 정보 (디스플레이용)
    channelItemName: varchar('channel_item_name', { length: 500 }),
    channelOptionName: varchar('channel_option_name', { length: 255 }),
    channelPrice: bigint('channel_price', { mode: 'number' }),
    channelProductUrl: varchar('channel_product_url', { length: 1000 }),

    // 상태
    isActive: boolean('is_active').default(true).notNull(),

    // 메타
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    // 핵심 인덱스: 채널 + 채널아이템ID로 variant 조회 (매우 빈번)
    uniqueIndex('uq_channel_variant_listing').on(table.salesChannelId, table.channelItemId),
    // variant 기준 조회 (관리 UI용)
    index('idx_channel_listings_variant').on(table.variantId),
    // 채널 기준 조회 (동기화용)
    index('idx_channel_listings_channel').on(table.salesChannelId),
  ],
);

// ===== BANNER GROUPS =====
export const bannerGroups = pgTable(
  'banner_groups',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    code: varchar('code', { length: 100 }).notNull().unique(),
    title: varchar('title', { length: 255 }).notNull(),
    category: varchar('category', { length: 100 }).notNull(),
    pcWidth: integer('pc_width'),
    pcHeight: integer('pc_height'),
    mobileWidth: integer('mobile_width'),
    mobileHeight: integer('mobile_height'),
    description: text('description'),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),

    deletedAt: timestamp('deleted_at'),
    deletedBy: uuid('deleted_by'),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
  },
  (table) => [
    index('idx_banner_groups_code').on(table.code),
    index('idx_banner_groups_category').on(table.category),
    index('idx_banner_groups_active').on(table.isActive),
    index('idx_banner_groups_deleted_at').on(table.deletedAt),
  ],
);

// ===== BANNERS =====
export const banners = pgTable(
  'banners',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    bannerGroupId: uuid('banner_group_id')
      .notNull()
      .references(() => bannerGroups.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    pcImageFileId: uuid('pc_image_file_id').notNull(),
    mobileImageFileId: uuid('mobile_image_file_id').notNull(),
    linkUrl: text('link_url'),
    linkedProductMasterIds: jsonb('linked_product_master_ids').$type<string[]>().default([]),
    displayStartAt: timestamp('display_start_at'),
    displayEndAt: timestamp('display_end_at'),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),

    deletedAt: timestamp('deleted_at'),
    deletedBy: uuid('deleted_by'),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
  },
  (table) => [
    index('idx_banners_group_id').on(table.bannerGroupId),
    index('idx_banners_active').on(table.isActive),
    index('idx_banners_display_period').on(table.displayStartAt, table.displayEndAt),
    index('idx_banners_deleted_at').on(table.deletedAt),
    index('idx_banners_group_sort').on(table.bannerGroupId, table.sortOrder),
  ],
);

// ===== NOTICES (공지사항) =====
export const notices = pgTable(
  'notices',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    title: varchar('title', { length: 255 }).notNull(),
    content: text('content').notNull(),
    category: varchar('category', { length: 50 }).notNull().default('general'),
    badge: varchar('badge', { length: 30 }),
    isPinned: boolean('is_pinned').notNull().default(false),
    displayStartAt: timestamp('display_start_at'),
    displayEndAt: timestamp('display_end_at'),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),

    deletedAt: timestamp('deleted_at'),
    deletedBy: uuid('deleted_by'),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
  },
  (table) => [
    index('idx_notices_category').on(table.category),
    index('idx_notices_active').on(table.isActive),
    index('idx_notices_pinned').on(table.isPinned),
    index('idx_notices_display_period').on(table.displayStartAt, table.displayEndAt),
    index('idx_notices_deleted_at').on(table.deletedAt),
    index('idx_notices_sort').on(table.isPinned, table.sortOrder, table.createdAt),
  ],
);

// Catalog BC 스키마 (ex-PIM)
export const catalogSchema = {
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
};

// ===== RELATIONS =====
export const productCategoriesRelations = relations(productCategories, ({ one, many }) => ({
  parent: one(productCategories, {
    fields: [productCategories.parentId],
    references: [productCategories.id],
  }),
  children: many(productCategories),
  productMasterCategories: many(productMasterCategories),
}));

export const productMastersRelations = relations(productMasters, ({ many }) => ({
  versions: many(productMasterVersions),
  productMasterCategories: many(productMasterCategories),
  productMasterOptionGroups: many(productMasterOptionGroups),
  productMasterVariants: many(productMasterVariants),
  productMasterPricingRules: many(productMasterPricingRules),
  channelProducts: many(channelProducts),
  productImages: many(productImages),
  productTagValues: many(productTagValues),
}));

export const productMasterVersionsRelations = relations(productMasterVersions, ({ one }) => ({
  master: one(productMasters, {
    fields: [productMasterVersions.masterId],
    references: [productMasters.id],
  }),
  parentVersion: one(productMasterVersions, {
    fields: [productMasterVersions.parentVersionId],
    references: [productMasterVersions.id],
  }),
}));

export const productMasterCategoriesRelations = relations(productMasterCategories, ({ one }) => ({
  master: one(productMasters, {
    fields: [productMasterCategories.masterId],
    references: [productMasters.id],
  }),
  category: one(productCategories, {
    fields: [productMasterCategories.categoryId],
    references: [productCategories.id],
  }),
}));

export const channelCategoriesRelations = relations(channelCategories, ({ many }) => ({
  channels: many(salesChannels),
}));

export const salesChannelsRelations = relations(salesChannels, ({ one, many }) => ({
  category: one(channelCategories, {
    fields: [salesChannels.categoryId],
    references: [channelCategories.id],
  }),
  channelProducts: many(channelProducts),
  channelListings: many(channelVariantListings),
}));

export const channelProductsRelations = relations(channelProducts, ({ one }) => ({
  master: one(productMasters, {
    fields: [channelProducts.masterId],
    references: [productMasters.id],
  }),
  channel: one(salesChannels, {
    fields: [channelProducts.channelId],
    references: [salesChannels.id],
  }),
}));

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

export const bannerGroupsRelations = relations(bannerGroups, ({ many }) => ({
  banners: many(banners),
}));

export const bannersRelations = relations(banners, ({ one }) => ({
  bannerGroup: one(bannerGroups, {
    fields: [banners.bannerGroupId],
    references: [bannerGroups.id],
  }),
}));

export const productVariantsRelations = relations(productVariants, ({ many }) => ({
  optionValues: many(variantOptionValues),
  channelListings: many(channelVariantListings),
}));

export const channelVariantListingsRelations = relations(channelVariantListings, ({ one }) => ({
  variant: one(productVariants, {
    fields: [channelVariantListings.variantId],
    references: [productVariants.id],
  }),
  channel: one(salesChannels, {
    fields: [channelVariantListings.salesChannelId],
    references: [salesChannels.id],
  }),
}));

// 스키마 타입 추출
export type CatalogSchema = typeof catalogSchema;

// PIM 호환 alias
export const pimSchema = catalogSchema;
export type PimSchema = CatalogSchema;
