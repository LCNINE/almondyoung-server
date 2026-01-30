import { pgEnum, pgTable, uuid, varchar, boolean, timestamp, integer, jsonb, text, bigint, index, uniqueIndex, foreignKey, primaryKey, unique } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const pricingRuleLayer = pgEnum("pricing_rule_layer", ["base_price", "membership_price", "tiered_price"])
export const pricingRuleOperationType = pgEnum("pricing_rule_operation_type", ["offset", "scale", "override"])
export const pricingRuleScopeType = pgEnum("pricing_rule_scope_type", ["all_variants", "with_option", "variants"])
export const productMasterVersionApprovalStatus = pgEnum("product_master_version_approval_status", ["draft", "pending", "approved", "rejected"])
export const productMasterVersionStatus = pgEnum("product_master_version_status", ["draft", "inactive", "active"])


export const bannerGroups = pgTable("banner_groups", {
	id: uuid().primaryKey(),
	code: varchar({ length: 100 }).notNull(),
	title: varchar({ length: 255 }).notNull(),
	category: varchar({ length: 100 }).notNull(),
	pcWidth: integer("pc_width"),
	pcHeight: integer("pc_height"),
	mobileWidth: integer("mobile_width"),
	mobileHeight: integer("mobile_height"),
	description: text(),
	isActive: boolean("is_active").default(true).notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
	deletedAt: timestamp("deleted_at"),
	deletedBy: uuid("deleted_by"),
	createdAt: timestamp("created_at").default(sql`now()`).notNull(),
	updatedAt: timestamp("updated_at").default(sql`now()`).notNull(),
	createdBy: uuid("created_by"),
	updatedBy: uuid("updated_by"),
}, (table) => [
	index("idx_banner_groups_active").using("btree", table.isActive.asc().nullsLast()),
	index("idx_banner_groups_category").using("btree", table.category.asc().nullsLast()),
	index("idx_banner_groups_code").using("btree", table.code.asc().nullsLast()),
	index("idx_banner_groups_deleted_at").using("btree", table.deletedAt.asc().nullsLast()),
	unique("banner_groups_code_unique").on(table.code),]);

export const banners = pgTable("banners", {
	id: uuid().primaryKey(),
	bannerGroupId: uuid("banner_group_id").notNull().references(() => bannerGroups.id, { onDelete: "cascade" } ),
	title: varchar({ length: 255 }).notNull(),
	description: text(),
	pcImageFileId: uuid("pc_image_file_id").notNull(),
	mobileImageFileId: uuid("mobile_image_file_id").notNull(),
	linkUrl: text("link_url"),
	linkedProductMasterIds: jsonb("linked_product_master_ids").default([]),
	displayStartAt: timestamp("display_start_at"),
	displayEndAt: timestamp("display_end_at"),
	isActive: boolean("is_active").default(true).notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
	deletedAt: timestamp("deleted_at"),
	deletedBy: uuid("deleted_by"),
	createdAt: timestamp("created_at").default(sql`now()`).notNull(),
	updatedAt: timestamp("updated_at").default(sql`now()`).notNull(),
	createdBy: uuid("created_by"),
	updatedBy: uuid("updated_by"),
}, (table) => [
	index("idx_banners_active").using("btree", table.isActive.asc().nullsLast()),
	index("idx_banners_deleted_at").using("btree", table.deletedAt.asc().nullsLast()),
	index("idx_banners_display_period").using("btree", table.displayStartAt.asc().nullsLast(), table.displayEndAt.asc().nullsLast()),
	index("idx_banners_group_id").using("btree", table.bannerGroupId.asc().nullsLast()),
	index("idx_banners_group_sort").using("btree", table.bannerGroupId.asc().nullsLast(), table.sortOrder.asc().nullsLast()),
]);

export const categoryTagGroups = pgTable("category_tag_groups", {
	categoryId: uuid("category_id").notNull().references(() => productCategories.id, { onDelete: "cascade" } ),
	tagGroupId: uuid("tag_group_id").notNull().references(() => tagGroups.id, { onDelete: "restrict" } ),
	displayOrder: integer("display_order").default(0).notNull(),
	isRequired: boolean("is_required").default(false).notNull(),
	appliesToDescendants: boolean("applies_to_descendants").default(false).notNull(),
	createdAt: timestamp("created_at").default(sql`now()`).notNull(),
}, (table) => [
	primaryKey({ columns: [table.categoryId, table.tagGroupId], name: "category_tag_groups_category_id_tag_group_id_pk"}),
	index("idx_category_tag_groups_category").using("btree", table.categoryId.asc().nullsLast()),
	index("idx_category_tag_groups_display_order").using("btree", table.categoryId.asc().nullsLast(), table.displayOrder.asc().nullsLast()),
	index("idx_category_tag_groups_group").using("btree", table.tagGroupId.asc().nullsLast()),
]);

export const channelCategories = pgTable("channel_categories", {
	id: uuid().primaryKey(),
	name: varchar({ length: 100 }).notNull(),
	description: text(),
	displayOrder: integer("display_order").default(0).notNull(),
	createdAt: timestamp("created_at").default(sql`now()`).notNull(),
	updatedAt: timestamp("updated_at").default(sql`now()`).notNull(),
}, (table) => [
	index("idx_channel_categories_order").using("btree", table.displayOrder.asc().nullsLast()),
]);

export const channelProducts = pgTable("channel_products", {
	id: uuid().primaryKey(),
	masterId: uuid("master_id").notNull().references(() => productMasters.id, { onDelete: "cascade" } ),
	channelId: uuid("channel_id").notNull().references(() => salesChannels.id, { onDelete: "cascade" } ),
	name: varchar({ length: 255 }),
	isActive: boolean("is_active").default(true).notNull(),
	channelSpecificData: jsonb("channel_specific_data"),
	createdAt: timestamp("created_at").default(sql`now()`).notNull(),
	updatedAt: timestamp("updated_at").default(sql`now()`).notNull(),
}, (table) => [
	index("idx_channel_products_active").using("btree", table.isActive.asc().nullsLast()),
	index("idx_channel_products_channel").using("btree", table.channelId.asc().nullsLast()),
	index("idx_channel_products_master").using("btree", table.masterId.asc().nullsLast()),
	uniqueIndex("unique_master_channel").using("btree", table.masterId.asc().nullsLast(), table.channelId.asc().nullsLast()),
]);

export const channelVariantListings = pgTable("channel_variant_listings", {
	id: uuid().primaryKey(),
	variantId: uuid("variant_id").notNull().references(() => productVariants.id, { onDelete: "cascade" } ),
	salesChannelId: uuid("sales_channel_id").notNull().references(() => salesChannels.id, { onDelete: "cascade" } ),
	channelItemId: varchar("channel_item_id", { length: 255 }).notNull(),
	channelItemName: varchar("channel_item_name", { length: 500 }),
	channelOptionName: varchar("channel_option_name", { length: 255 }),
	channelPrice: bigint("channel_price", { mode: 'number' }),
	channelProductUrl: varchar("channel_product_url", { length: 1000 }),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at").default(sql`now()`).notNull(),
	updatedAt: timestamp("updated_at").default(sql`now()`).notNull(),
}, (table) => [
	index("idx_channel_listings_channel").using("btree", table.salesChannelId.asc().nullsLast()),
	index("idx_channel_listings_variant").using("btree", table.variantId.asc().nullsLast()),
	uniqueIndex("uq_channel_variant_listing").using("btree", table.salesChannelId.asc().nullsLast(), table.channelItemId.asc().nullsLast()),
]);

export const pricingRules = pgTable("pricing_rules", {
	id: uuid().primaryKey(),
	layer: pricingRuleLayer().notNull(),
	order: integer().notNull(),
	scopeType: pricingRuleScopeType("scope_type").notNull(),
	scopeTargetIds: uuid("scope_target_ids").array(),
	operationType: pricingRuleOperationType("operation_type").notNull(),
	operationValue: bigint("operation_value", { mode: 'number' }).notNull(),
	minQuantity: integer("min_quantity"),
	createdAt: timestamp("created_at").default(sql`now()`).notNull(),
	updatedAt: timestamp("updated_at").default(sql`now()`).notNull(),
});

export const productApprovalHistory = pgTable("product_approval_history", {
	id: uuid().primaryKey(),
	status: varchar({ length: 20 }).notNull(),
	comment: text(),
	approvedBy: uuid("approved_by").notNull(),
	createdAt: timestamp("created_at").default(sql`now()`).notNull(),
	versionId: uuid("version_id").notNull().references(() => productMasterVersions.id, { onDelete: "cascade" } ),
}, (table) => [
	index("idx_approval_history_date").using("btree", table.createdAt.asc().nullsLast()),
	index("idx_approval_history_status").using("btree", table.status.asc().nullsLast()),
	index("idx_approval_history_version").using("btree", table.versionId.asc().nullsLast()),
]);

export const productAuditLog = pgTable("product_audit_log", {
	id: uuid().primaryKey(),
	action: varchar({ length: 50 }).notNull(),
	changes: jsonb(),
	userId: uuid("user_id").notNull(),
	userEmail: varchar("user_email", { length: 255 }),
	timestamp: timestamp().default(sql`now()`).notNull(),
	ipAddress: varchar("ip_address", { length: 45 }),
	userAgent: text("user_agent"),
	versionId: uuid("version_id").notNull(),
}, (table) => [
	index("idx_audit_log_action").using("btree", table.action.asc().nullsLast()),
	index("idx_audit_log_timestamp").using("btree", table.timestamp.asc().nullsLast()),
	index("idx_audit_log_user").using("btree", table.userId.asc().nullsLast()),
	index("idx_audit_log_version").using("btree", table.versionId.asc().nullsLast()),
]);

export const productCategories = pgTable("product_categories", {
	id: uuid().primaryKey(),
	name: varchar({ length: 255 }).notNull(),
	description: text(),
	slug: varchar({ length: 255 }).notNull(),
	parentId: uuid("parent_id"),
	level: integer().default(0).notNull(),
	path: varchar({ length: 1000 }).default("").notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at").default(sql`now()`).notNull(),
	updatedAt: timestamp("updated_at").default(sql`now()`).notNull(),
	createdBy: uuid("created_by"),
	updatedBy: uuid("updated_by"),
	imageUrl: text("image_url"),
	visibility: boolean().default(true).notNull(),
	displaySettings: jsonb("display_settings"),
	seoConfig: jsonb("seo_config"),
	templateConfig: jsonb("template_config"),
}, (table) => [
	foreignKey({
		columns: [table.parentId],
		foreignColumns: [table.id],
		name: "product_categories_parent_id_product_categories_id_fk"
	}),
	index("idx_categories_active").using("btree", table.isActive.asc().nullsLast()),
	index("idx_categories_level").using("btree", table.level.asc().nullsLast()),
	index("idx_categories_parent_id").using("btree", table.parentId.asc().nullsLast()),
	index("idx_categories_path").using("btree", table.path.asc().nullsLast()),
	index("idx_categories_slug").using("btree", table.slug.asc().nullsLast()),
	index("idx_categories_sort_order").using("btree", table.parentId.asc().nullsLast(), table.sortOrder.asc().nullsLast()),
	unique("product_categories_slug_unique").on(table.slug),]);

export const productImages = pgTable("product_images", {
	id: uuid().primaryKey(),
	isPrimary: boolean("is_primary").default(false).notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
	createdAt: timestamp("created_at").default(sql`now()`).notNull(),
	versionId: uuid("version_id").notNull().references(() => productMasterVersions.id, { onDelete: "cascade" } ),
	fileId: uuid("file_id").notNull(),
}, (table) => [
	index("idx_product_images_primary").using("btree", table.versionId.asc().nullsLast(), table.isPrimary.asc().nullsLast()),
	index("idx_product_images_sort").using("btree", table.versionId.asc().nullsLast(), table.sortOrder.asc().nullsLast()),
	index("idx_product_images_version").using("btree", table.versionId.asc().nullsLast()),
	uniqueIndex("unique_product_primary_image").using("btree", table.versionId.asc().nullsLast()).where(sql`(is_primary = true)`),
]);

export const productMasterCategories = pgTable("product_master_categories", {
	id: uuid().primaryKey(),
	masterId: uuid("master_id").notNull().references(() => productMasters.id, { onDelete: "cascade" } ),
	categoryId: uuid("category_id").notNull().references(() => productCategories.id, { onDelete: "cascade" } ),
	isPrimary: boolean("is_primary").default(false).notNull(),
	createdAt: timestamp("created_at").default(sql`now()`).notNull(),
	createdBy: uuid("created_by"),
	versionId: uuid("version_id").notNull().references(() => productMasterVersions.id, { onDelete: "cascade" } ),
}, (table) => [
	index("idx_master_categories_category").using("btree", table.categoryId.asc().nullsLast()),
	index("idx_master_categories_master_version").using("btree", table.masterId.asc().nullsLast(), table.versionId.asc().nullsLast()),
	index("idx_master_categories_primary").using("btree", table.masterId.asc().nullsLast(), table.isPrimary.asc().nullsLast()),
	uniqueIndex("unique_master_category_version").using("btree", table.masterId.asc().nullsLast(), table.categoryId.asc().nullsLast(), table.versionId.asc().nullsLast()),
]);

export const productMasterOptionGroups = pgTable("product_master_option_groups", {
	id: uuid().primaryKey(),
	masterId: uuid("master_id").notNull().references(() => productMasters.id, { onDelete: "cascade" } ),
	optionGroupId: uuid("option_group_id").notNull().references(() => productOptionGroups.id, { onDelete: "cascade" } ),
	createdAt: timestamp("created_at").default(sql`now()`).notNull(),
	versionId: uuid("version_id").notNull().references(() => productMasterVersions.id, { onDelete: "cascade" } ),
}, (table) => [
	index("idx_master_option_groups_master_version").using("btree", table.masterId.asc().nullsLast(), table.versionId.asc().nullsLast()),
	uniqueIndex("unique_master_option_group_version").using("btree", table.masterId.asc().nullsLast(), table.optionGroupId.asc().nullsLast(), table.versionId.asc().nullsLast()),
]);

export const productMasterPricingRules = pgTable("product_master_pricing_rules", {
	id: uuid().primaryKey(),
	masterId: uuid("master_id").notNull().references(() => productMasters.id, { onDelete: "cascade" } ),
	pricingRuleId: uuid("pricing_rule_id").notNull().references(() => pricingRules.id, { onDelete: "cascade" } ),
	createdAt: timestamp("created_at").default(sql`now()`).notNull(),
	versionId: uuid("version_id").notNull().references(() => productMasterVersions.id, { onDelete: "cascade" } ),
}, (table) => [
	index("idx_master_pricing_rules_master_version").using("btree", table.masterId.asc().nullsLast(), table.versionId.asc().nullsLast()),
	uniqueIndex("unique_master_pricing_rule_version").using("btree", table.masterId.asc().nullsLast(), table.pricingRuleId.asc().nullsLast(), table.versionId.asc().nullsLast()),
]);

export const productMasterVariants = pgTable("product_master_variants", {
	id: uuid().primaryKey(),
	masterId: uuid("master_id").notNull().references(() => productMasters.id, { onDelete: "cascade" } ),
	variantId: uuid("variant_id").notNull().references(() => productVariants.id, { onDelete: "cascade" } ),
	createdAt: timestamp("created_at").default(sql`now()`).notNull(),
	versionId: uuid("version_id").notNull().references(() => productMasterVersions.id, { onDelete: "cascade" } ),
}, (table) => [
	index("idx_master_variants_master_version").using("btree", table.masterId.asc().nullsLast(), table.versionId.asc().nullsLast()),
	uniqueIndex("unique_master_variant_version").using("btree", table.masterId.asc().nullsLast(), table.variantId.asc().nullsLast(), table.versionId.asc().nullsLast()),
]);

export const productMasterVersions = pgTable("product_master_versions", {
	id: uuid().primaryKey(),
	masterId: uuid("master_id").notNull().references(() => productMasters.id, { onDelete: "cascade" } ),
	version: integer().default(1).notNull(),
	parentVersionId: uuid("parent_version_id"),
	draftOwnerId: uuid("draft_owner_id"),
	name: varchar({ length: 255 }).default("새 상품").notNull(),
	description: text(),
	brand: varchar({ length: 100 }),
	thumbnail: text(),
	seoTitle: varchar("seo_title", { length: 255 }),
	seoDescription: text("seo_description"),
	seoKeywords: text("seo_keywords").array(),
	descriptionHtml: text("description_html"),
	status: productMasterVersionStatus().default("draft").notNull(),
	isWholesaleOnly: boolean("is_wholesale_only").default(false).notNull(),
	isMembershipOnly: boolean("is_membership_only").default(false).notNull(),
	productType: varchar("product_type", { length: 50 }).default("regular_sale").notNull(),
	productCode: varchar("product_code", { length: 100 }),
	alternativeName: varchar("alternative_name", { length: 255 }),
	material: text(),
	salesClassification: varchar("sales_classification", { length: 100 }),
	purchaseClassification: varchar("purchase_classification", { length: 100 }),
	shippingMethodId: uuid("shipping_method_id"),
	marketPrice: bigint("market_price", { mode: 'number' }),
	supplyPrice: bigint("supply_price", { mode: 'number' }),
	supplierId: uuid("supplier_id"),
	ageRestriction: integer("age_restriction").default(0).notNull(),
	minQuantity: integer("min_quantity").default(1).notNull(),
	maxQuantity: integer("max_quantity"),
	salesStartDate: timestamp("sales_start_date"),
	salesEndDate: timestamp("sales_end_date"),
	approvalStatus: productMasterVersionApprovalStatus("approval_status").default("draft").notNull(),
	approvedAt: timestamp("approved_at"),
	approvedBy: uuid("approved_by"),
	rejectionReason: text("rejection_reason"),
	deletedAt: timestamp("deleted_at"),
	deletedBy: uuid("deleted_by"),
	seller: varchar({ length: 100 }),
	registrationDate: timestamp("registration_date").default(sql`now()`).notNull(),
	createdAt: timestamp("created_at").default(sql`now()`).notNull(),
	updatedAt: timestamp("updated_at").default(sql`now()`).notNull(),
	createdBy: uuid("created_by"),
	updatedBy: uuid("updated_by"),
}, (table) => [
	foreignKey({
		columns: [table.parentVersionId],
		foreignColumns: [table.id],
		name: "product_master_versions_parent_version_id_product_master_versio"
	}),
	index("idx_versions_approval_status").using("btree", table.approvalStatus.asc().nullsLast()),
	index("idx_versions_brand").using("btree", table.brand.asc().nullsLast()),
	index("idx_versions_created_at").using("btree", table.createdAt.asc().nullsLast()),
	index("idx_versions_deleted_at").using("btree", table.deletedAt.asc().nullsLast()),
	index("idx_versions_master_id").using("btree", table.masterId.asc().nullsLast()),
	index("idx_versions_master_version").using("btree", table.masterId.asc().nullsLast(), table.version.asc().nullsLast()),
	index("idx_versions_name").using("btree", table.name.asc().nullsLast()),
	index("idx_versions_product_code").using("btree", table.productCode.asc().nullsLast()),
	index("idx_versions_product_type").using("btree", table.productType.asc().nullsLast()),
	index("idx_versions_sales_dates").using("btree", table.salesStartDate.asc().nullsLast(), table.salesEndDate.asc().nullsLast()),
	index("idx_versions_status").using("btree", table.status.asc().nullsLast()),
	index("idx_versions_supplier").using("btree", table.supplierId.asc().nullsLast()),
	uniqueIndex("unique_master_active_version").using("btree", table.masterId.asc().nullsLast()).where(sql`(status = 'active'::product_master_version_status)`),
	uniqueIndex("unique_master_version").using("btree", table.masterId.asc().nullsLast(), table.version.asc().nullsLast()),
	unique("product_master_versions_product_code_unique").on(table.productCode),]);

export const productMasters = pgTable("product_masters", {
	id: uuid().primaryKey(),
	createdAt: timestamp("created_at").default(sql`now()`).notNull(),
	createdBy: uuid("created_by"),
	deletedAt: timestamp("deleted_at"),
	deletedBy: uuid("deleted_by"),
}, (table) => [
	index("idx_masters_created_at").using("btree", table.createdAt.asc().nullsLast()),
	index("idx_masters_deleted_at").using("btree", table.deletedAt.asc().nullsLast()),
]);

export const productOptionGroupDisplays = pgTable("product_option_group_displays", {
	id: uuid().primaryKey(),
	optionGroupId: uuid("option_group_id").notNull().references(() => productOptionGroups.id, { onDelete: "cascade" } ),
	masterId: uuid("master_id").notNull().references(() => productMasters.id, { onDelete: "cascade" } ),
	locale: varchar({ length: 10 }).default("ko-KR").notNull(),
	displayName: varchar("display_name", { length: 100 }).notNull(),
	description: text(),
	sortOrder: integer("sort_order").default(0).notNull(),
	createdAt: timestamp("created_at").default(sql`now()`).notNull(),
	versionId: uuid("version_id").notNull().references(() => productMasterVersions.id, { onDelete: "cascade" } ),
}, (table) => [
	index("idx_option_group_displays_lookup").using("btree", table.optionGroupId.asc().nullsLast(), table.masterId.asc().nullsLast(), table.versionId.asc().nullsLast(), table.locale.asc().nullsLast()),
	uniqueIndex("unique_option_group_display").using("btree", table.optionGroupId.asc().nullsLast(), table.masterId.asc().nullsLast(), table.versionId.asc().nullsLast(), table.locale.asc().nullsLast()),
]);

export const productOptionGroups = pgTable("product_option_groups", {
	id: uuid().primaryKey(),
	createdAt: timestamp("created_at").default(sql`now()`).notNull(),
});

export const productOptionValueDisplays = pgTable("product_option_value_displays", {
	id: uuid().primaryKey(),
	optionValueId: uuid("option_value_id").notNull().references(() => productOptionValues.id, { onDelete: "cascade" } ),
	masterId: uuid("master_id").notNull().references(() => productMasters.id, { onDelete: "cascade" } ),
	locale: varchar({ length: 10 }).default("ko-KR").notNull(),
	displayName: varchar("display_name", { length: 100 }).notNull(),
	colorCode: varchar("color_code", { length: 7 }),
	imageUrl: text("image_url"),
	sortOrder: integer("sort_order").default(0).notNull(),
	createdAt: timestamp("created_at").default(sql`now()`).notNull(),
	versionId: uuid("version_id").notNull().references(() => productMasterVersions.id, { onDelete: "cascade" } ),
}, (table) => [
	index("idx_option_value_displays_lookup").using("btree", table.optionValueId.asc().nullsLast(), table.masterId.asc().nullsLast(), table.versionId.asc().nullsLast(), table.locale.asc().nullsLast()),
	uniqueIndex("unique_option_value_display").using("btree", table.optionValueId.asc().nullsLast(), table.masterId.asc().nullsLast(), table.versionId.asc().nullsLast(), table.locale.asc().nullsLast()),
]);

export const productOptionValues = pgTable("product_option_values", {
	id: uuid().primaryKey(),
	optionGroupId: uuid("option_group_id").notNull().references(() => productOptionGroups.id, { onDelete: "cascade" } ),
	createdAt: timestamp("created_at").default(sql`now()`).notNull(),
}, (table) => [
	index("idx_option_values_group").using("btree", table.optionGroupId.asc().nullsLast()),
]);

export const productTagValues = pgTable("product_tag_values", {
	masterId: uuid("master_id").notNull().references(() => productMasters.id, { onDelete: "cascade" } ),
	tagValueId: uuid("tag_value_id").notNull().references(() => tagValues.id, { onDelete: "restrict" } ),
	createdAt: timestamp("created_at").default(sql`now()`).notNull(),
	versionId: uuid("version_id").notNull().references(() => productMasterVersions.id, { onDelete: "cascade" } ),
}, (table) => [
	primaryKey({ columns: [table.masterId, table.versionId, table.tagValueId], name: "product_tag_values_master_id_version_id_tag_value_id_pk"}),
	index("idx_product_tag_values_master_version").using("btree", table.masterId.asc().nullsLast(), table.versionId.asc().nullsLast()),
	index("idx_product_tag_values_tag").using("btree", table.tagValueId.asc().nullsLast()),
]);

export const productVariantPriceCache = pgTable("product_variant_price_cache", {
	id: uuid().primaryKey(),
	versionId: uuid("version_id").notNull().references(() => productMasterVersions.id, { onDelete: "cascade" } ),
	variantId: uuid("variant_id").notNull().references(() => productVariants.id, { onDelete: "cascade" } ),
	basePrice: bigint("base_price", { mode: 'number' }).notNull(),
	membershipPrice: bigint("membership_price", { mode: 'number' }).notNull(),
	tieredPrices: jsonb("tiered_prices").default([]).notNull(),
	createdAt: timestamp("created_at").default(sql`now()`).notNull(),
}, (table) => [
	index("idx_variant_price_cache_variant").using("btree", table.variantId.asc().nullsLast()),
	index("idx_variant_price_cache_version").using("btree", table.versionId.asc().nullsLast()),
	uniqueIndex("unique_variant_price_cache_version_variant").using("btree", table.versionId.asc().nullsLast(), table.variantId.asc().nullsLast()),
]);

export const productVariants = pgTable("product_variants", {
	id: uuid().primaryKey(),
	variantName: varchar("variant_name", { length: 255 }),
	displayOrder: integer("display_order").default(0).notNull(),
	status: varchar({ length: 20 }).default("active").notNull(),
	isDefault: boolean("is_default").default(false).notNull(),
	createdAt: timestamp("created_at").default(sql`now()`).notNull(),
	updatedAt: timestamp("updated_at").default(sql`now()`).notNull(),
	variantCode: varchar("variant_code", { length: 100 }),
	imageId: uuid("image_id"),
}, (table) => [
	index("idx_variants_code").using("btree", table.variantCode.asc().nullsLast()),
	index("idx_variants_created_at").using("btree", table.createdAt.asc().nullsLast()),
	index("idx_variants_is_default").using("btree", table.isDefault.asc().nullsLast()),
	index("idx_variants_status").using("btree", table.status.asc().nullsLast()),
	unique("product_variants_variant_code_unique").on(table.variantCode),]);

export const promotionProducts = pgTable("promotion_products", {
	id: uuid().primaryKey(),
	promotionId: uuid("promotion_id").notNull().references(() => promotions.id, { onDelete: "cascade" } ),
	masterId: uuid("master_id").notNull().references(() => productMasters.id, { onDelete: "cascade" } ),
	variantId: uuid("variant_id").references(() => productVariants.id),
});

export const promotions = pgTable("promotions", {
	id: uuid().primaryKey(),
	name: varchar({ length: 255 }).notNull(),
	description: text(),
	startAt: timestamp("start_at").notNull(),
	endAt: timestamp("end_at").notNull(),
	discountType: varchar("discount_type", { length: 20 }).notNull(),
	discountValue: integer("discount_value").notNull(),
	createdAt: timestamp("created_at").default(sql`now()`).notNull(),
});

export const salesChannels = pgTable("sales_channels", {
	id: uuid().primaryKey(),
	type: varchar({ length: 50 }).default("ONLINE").notNull(),
	name: varchar({ length: 100 }).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at").default(sql`now()`).notNull(),
	updatedAt: timestamp("updated_at").default(sql`now()`).notNull(),
	site: varchar({ length: 50 }).notNull(),
	categoryId: uuid("category_id").references(() => channelCategories.id, { onDelete: "set null" } ),
	description: text(),
	config: jsonb(),
	apiEndpoint: varchar("api_endpoint", { length: 500 }),
	credentials: jsonb(),
}, (table) => [
	index("idx_sales_channels_active").using("btree", table.isActive.asc().nullsLast()),
	index("idx_sales_channels_category").using("btree", table.categoryId.asc().nullsLast()),
	index("idx_sales_channels_site").using("btree", table.site.asc().nullsLast()),
	index("idx_sales_channels_type").using("btree", table.type.asc().nullsLast()),
]);

export const tagGroups = pgTable("tag_groups", {
	id: uuid().primaryKey(),
	name: varchar({ length: 100 }).notNull(),
	description: text(),
	displayOrder: integer("display_order").default(0).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at").default(sql`now()`).notNull(),
	updatedAt: timestamp("updated_at").default(sql`now()`).notNull(),
}, (table) => [
	index("idx_tag_groups_active").using("btree", table.isActive.asc().nullsLast()),
	index("idx_tag_groups_display_order").using("btree", table.displayOrder.asc().nullsLast()),
]);

export const tagValues = pgTable("tag_values", {
	id: uuid().primaryKey(),
	groupId: uuid("group_id").notNull().references(() => tagGroups.id, { onDelete: "restrict" } ),
	name: varchar({ length: 100 }).notNull(),
	displayOrder: integer("display_order").default(0).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at").default(sql`now()`).notNull(),
	updatedAt: timestamp("updated_at").default(sql`now()`).notNull(),
}, (table) => [
	index("idx_tag_values_active").using("btree", table.isActive.asc().nullsLast()),
	index("idx_tag_values_display_order").using("btree", table.groupId.asc().nullsLast(), table.displayOrder.asc().nullsLast()),
	index("idx_tag_values_group_id").using("btree", table.groupId.asc().nullsLast()),
	uniqueIndex("unique_tag_values_group_name").using("btree", table.groupId.asc().nullsLast(), table.name.asc().nullsLast()),
]);

export const variantOptionValues = pgTable("variant_option_values", {
	id: uuid().primaryKey(),
	variantId: uuid("variant_id").notNull().references(() => productVariants.id, { onDelete: "cascade" } ),
	optionValueId: uuid("option_value_id").notNull().references(() => productOptionValues.id, { onDelete: "cascade" } ),
}, (table) => [
	index("idx_variant_options_value").using("btree", table.optionValueId.asc().nullsLast()),
	index("idx_variant_options_variant").using("btree", table.variantId.asc().nullsLast()),
	uniqueIndex("unique_variant_option_values").using("btree", table.variantId.asc().nullsLast(), table.optionValueId.asc().nullsLast()),
]);
