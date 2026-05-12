/**
 * PIM Schema Type Definitions
 *
 * Drizzle schema로부터 추론된 타입들을 중앙에서 관리합니다.
 * 모든 mapper와 service에서 이 타입들을 import하여 사용합니다.
 */

import {
  productCategories,
  productMasters,
  productMasterVersions,
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
} from './catalog.schema';

// ===== Category Types =====
export type CategoryEntity = typeof productCategories.$inferSelect;
export type CategoryInsert = typeof productCategories.$inferInsert;

// ===== Product Master Types =====
export type ProductMasterEntity = typeof productMasters.$inferSelect;
export type ProductMasterInsert = typeof productMasters.$inferInsert;

export type ProductMasterVersionEntity = typeof productMasterVersions.$inferSelect;
export type ProductMasterVersionInsert = typeof productMasterVersions.$inferInsert;

export type ProductMasterCategoryEntity = typeof productMasterCategories.$inferSelect;
export type ProductMasterCategoryInsert = typeof productMasterCategories.$inferInsert;

// ===== Product Option Types =====
export type ProductOptionGroupEntity = typeof productOptionGroups.$inferSelect;
export type ProductOptionGroupInsert = typeof productOptionGroups.$inferInsert;

export type ProductOptionValueEntity = typeof productOptionValues.$inferSelect;
export type ProductOptionValueInsert = typeof productOptionValues.$inferInsert;

export type ProductOptionGroupDisplayEntity = typeof productOptionGroupDisplays.$inferSelect;
export type ProductOptionGroupDisplayInsert = typeof productOptionGroupDisplays.$inferInsert;

export type ProductOptionValueDisplayEntity = typeof productOptionValueDisplays.$inferSelect;
export type ProductOptionValueDisplayInsert = typeof productOptionValueDisplays.$inferInsert;

// ===== Product Variant Types =====
export type ProductVariantEntity = typeof productVariants.$inferSelect;
export type ProductVariantInsert = typeof productVariants.$inferInsert;

export type VariantOptionValueEntity = typeof variantOptionValues.$inferSelect;
export type VariantOptionValueInsert = typeof variantOptionValues.$inferInsert;

export type ProductMasterVariantEntity = typeof productMasterVariants.$inferSelect;
export type ProductMasterVariantInsert = typeof productMasterVariants.$inferInsert;

// ===== Channel Types =====
export type ChannelCategoryEntity = typeof channelCategories.$inferSelect;
export type ChannelCategoryInsert = typeof channelCategories.$inferInsert;

export type SalesChannelEntity = typeof salesChannels.$inferSelect;
export type SalesChannelInsert = typeof salesChannels.$inferInsert;

export type ChannelProductEntity = typeof channelProducts.$inferSelect;
export type ChannelProductInsert = typeof channelProducts.$inferInsert;

export type ChannelVariantListingEntity = typeof channelVariantListings.$inferSelect;
export type ChannelVariantListingInsert = typeof channelVariantListings.$inferInsert;

// ===== Pricing Types =====
export type PricingRuleEntity = typeof pricingRules.$inferSelect;
export type PricingRuleInsert = typeof pricingRules.$inferInsert;

export type ProductMasterPricingRuleEntity = typeof productMasterPricingRules.$inferSelect;
export type ProductMasterPricingRuleInsert = typeof productMasterPricingRules.$inferInsert;

export type ProductVariantPriceCacheEntity = typeof productVariantPriceCache.$inferSelect;
export type ProductVariantPriceCacheInsert = typeof productVariantPriceCache.$inferInsert;

// ===== Tag Types =====
export type TagGroupEntity = typeof tagGroups.$inferSelect;
export type TagGroupInsert = typeof tagGroups.$inferInsert;

export type TagValueEntity = typeof tagValues.$inferSelect;
export type TagValueInsert = typeof tagValues.$inferInsert;

export type CategoryTagGroupEntity = typeof categoryTagGroups.$inferSelect;
export type CategoryTagGroupInsert = typeof categoryTagGroups.$inferInsert;

export type ProductTagValueEntity = typeof productTagValues.$inferSelect;
export type ProductTagValueInsert = typeof productTagValues.$inferInsert;

// ===== Banner Types =====
export type BannerGroupEntity = typeof bannerGroups.$inferSelect;
export type BannerGroupInsert = typeof bannerGroups.$inferInsert;

export type BannerEntity = typeof banners.$inferSelect;
export type BannerInsert = typeof banners.$inferInsert;

// ===== Other Types =====
export type ProductImageEntity = typeof productImages.$inferSelect;
export type ProductImageInsert = typeof productImages.$inferInsert;

export type ProductApprovalHistoryEntity = typeof productApprovalHistory.$inferSelect;
export type ProductApprovalHistoryInsert = typeof productApprovalHistory.$inferInsert;

export type ProductAuditLogEntity = typeof productAuditLog.$inferSelect;
export type ProductAuditLogInsert = typeof productAuditLog.$inferInsert;
