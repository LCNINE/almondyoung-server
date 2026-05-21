/**
 * Library BC schema.
 *
 * 디지털 자산과 그 소유권을 관리한다.
 *
 * - digitalAssets: 1 row = 1 자산. 메타데이터 + 현재 파일 버전 포인터.
 * - digitalAssetFileVersions: 파일 버전 immutable 이력 (`docs/adr/0007`).
 * - productVariantDigitalAssetLinks: variant ↔ asset M:M 매칭. SKU 매칭의
 *   `productVariantSkuLinks` 와 대칭. variant CoW 시 함께 clone 됨 (`docs/adr/0004`).
 * - digitalAssetOwnerships: 결제 단일 grant 경로 (`docs/adr/0008`). 본 이슈는
 *   schema 만 추가 — 실제 ownership 발급/사용은 이후 이슈에서.
 */
import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { type InferSelectModel, type InferInsertModel, relations } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

// ===== 1. DIGITAL ASSETS =====
export const digitalAssets = pgTable(
  'digital_assets',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    mimeType: varchar('mime_type', { length: 255 }),
    thumbnailUrl: text('thumbnail_url'),
    // 현재 다운로드 가능한 파일 버전. asset 등록 직후엔 NULL 일 수 있음
    // (메타데이터만 먼저 만든 뒤 파일을 올리는 운영 흐름 허용).
    currentFileVersionId: uuid('current_file_version_id').references(
      (): any => digitalAssetFileVersions.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by'),
  },
  (t) => [
    index('idx_digital_assets_name').on(t.name),
    index('idx_digital_assets_created_at').on(t.createdAt),
    index('idx_digital_assets_deleted_at').on(t.deletedAt),
  ],
);

// ===== 2. DIGITAL ASSET FILE VERSIONS (immutable history) =====
export const digitalAssetFileVersions = pgTable(
  'digital_asset_file_versions',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => digitalAssets.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    // file-service 의 file id
    fileId: uuid('file_id').notNull(),
    releaseNote: text('release_note'),
    releasedAt: timestamp('released_at', { withTimezone: true }).notNull().defaultNow(),
    releasedBy: uuid('released_by'),
  },
  (t) => [
    index('idx_dafv_asset').on(t.assetId),
    uniqueIndex('uniq_dafv_asset_version').on(t.assetId, t.version),
  ],
);

// ===== 3. PRODUCT VARIANT ↔ DIGITAL ASSET LINKS =====
// variant ↔ asset M:M. variantId 는 catalog.productVariants 를 가리키지만
// 다른 BC 라 cross-module FK 는 두지 않는다 (productVariantSkuLinks 와 동일 패턴).
export const productVariantDigitalAssetLinks = pgTable(
  'product_variant_digital_asset_links',
  {
    variantId: uuid('variant_id').notNull(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => digitalAssets.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
  },
  (t) => [
    primaryKey({ columns: [t.variantId, t.assetId] }),
    index('idx_pvdal_variant').on(t.variantId),
    index('idx_pvdal_asset').on(t.assetId),
  ],
);

// ===== 4. DIGITAL ASSET OWNERSHIPS =====
// 본 이슈에서는 schema 만 추가. 실제 ownership 발급/사용은 후속 이슈.
// 결제 단일 grant 경로 — salesOrderId 는 항상 non-null (docs/adr/0008).
export const digitalAssetOwnerships = pgTable(
  'digital_asset_ownerships',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    customerId: uuid('customer_id').notNull(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => digitalAssets.id, { onDelete: 'restrict' }),
    salesOrderId: uuid('sales_order_id').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    // exercise boundary 패턴. exercise 전에는 다운로드 불가 + 환불 가능.
    exercisedAt: timestamp('exercised_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
  },
  (t) => [
    index('idx_dao_customer').on(t.customerId),
    index('idx_dao_asset').on(t.assetId),
    index('idx_dao_order').on(t.salesOrderId),
    uniqueIndex('uniq_dao_customer_asset_order').on(t.customerId, t.assetId, t.salesOrderId),
  ],
);

// ===== RELATIONS =====
export const digitalAssetsRelations = relations(digitalAssets, ({ one, many }) => ({
  currentFileVersion: one(digitalAssetFileVersions, {
    fields: [digitalAssets.currentFileVersionId],
    references: [digitalAssetFileVersions.id],
    relationName: 'currentFileVersion',
  }),
  fileVersions: many(digitalAssetFileVersions, { relationName: 'assetFileVersions' }),
  variantLinks: many(productVariantDigitalAssetLinks),
  ownerships: many(digitalAssetOwnerships),
}));

export const digitalAssetFileVersionsRelations = relations(digitalAssetFileVersions, ({ one }) => ({
  asset: one(digitalAssets, {
    fields: [digitalAssetFileVersions.assetId],
    references: [digitalAssets.id],
    relationName: 'assetFileVersions',
  }),
}));

export const productVariantDigitalAssetLinksRelations = relations(
  productVariantDigitalAssetLinks,
  ({ one }) => ({
    asset: one(digitalAssets, {
      fields: [productVariantDigitalAssetLinks.assetId],
      references: [digitalAssets.id],
    }),
  }),
);

export const digitalAssetOwnershipsRelations = relations(digitalAssetOwnerships, ({ one }) => ({
  asset: one(digitalAssets, {
    fields: [digitalAssetOwnerships.assetId],
    references: [digitalAssets.id],
  }),
}));

// ===== SCHEMA EXPORT =====
export const librarySchema = {
  digitalAssets,
  digitalAssetFileVersions,
  productVariantDigitalAssetLinks,
  digitalAssetOwnerships,
  digitalAssetsRelations,
  digitalAssetFileVersionsRelations,
  productVariantDigitalAssetLinksRelations,
  digitalAssetOwnershipsRelations,
};

export type LibrarySchema = typeof librarySchema;

// ===== TYPES =====
export type DigitalAsset = InferSelectModel<typeof digitalAssets>;
export type NewDigitalAsset = InferInsertModel<typeof digitalAssets>;
export type DigitalAssetFileVersion = InferSelectModel<typeof digitalAssetFileVersions>;
export type NewDigitalAssetFileVersion = InferInsertModel<typeof digitalAssetFileVersions>;
export type ProductVariantDigitalAssetLink = InferSelectModel<typeof productVariantDigitalAssetLinks>;
export type NewProductVariantDigitalAssetLink = InferInsertModel<typeof productVariantDigitalAssetLinks>;
export type DigitalAssetOwnership = InferSelectModel<typeof digitalAssetOwnerships>;
export type NewDigitalAssetOwnership = InferInsertModel<typeof digitalAssetOwnerships>;
