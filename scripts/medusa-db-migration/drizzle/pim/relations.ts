import { defineRelations } from "drizzle-orm";
import * as schema from "./schema";

export const relations = defineRelations(schema, (r) => ({
	banners: {
		bannerGroup: r.one.bannerGroups({
			from: r.banners.bannerGroupId,
			to: r.bannerGroups.id
		}),
	},
	bannerGroups: {
		banners: r.many.banners(),
	},
	productCategories: {
		tagGroups: r.many.tagGroups({
			from: r.productCategories.id.through(r.categoryTagGroups.categoryId),
			to: r.tagGroups.id.through(r.categoryTagGroups.tagGroupId)
		}),
		productCategory: r.one.productCategories({
			from: r.productCategories.parentId,
			to: r.productCategories.id,
			alias: "productCategories_parentId_productCategories_id"
		}),
		productCategories: r.many.productCategories({
			alias: "productCategories_parentId_productCategories_id"
		}),
		productMasterCategories: r.many.productMasterCategories(),
	},
	tagGroups: {
		productCategories: r.many.productCategories(),
		tagValues: r.many.tagValues(),
	},
	salesChannels: {
		productMasters: r.many.productMasters({
			from: r.salesChannels.id.through(r.channelProducts.channelId),
			to: r.productMasters.id.through(r.channelProducts.masterId)
		}),
		productVariants: r.many.productVariants({
			from: r.salesChannels.id.through(r.channelVariantListings.salesChannelId),
			to: r.productVariants.id.through(r.channelVariantListings.variantId)
		}),
		channelCategory: r.one.channelCategories({
			from: r.salesChannels.categoryId,
			to: r.channelCategories.id
		}),
	},
	productMasters: {
		salesChannels: r.many.salesChannels(),
		productMasterCategories: r.many.productMasterCategories(),
		productMasterOptionGroups: r.many.productMasterOptionGroups(),
		productMasterPricingRules: r.many.productMasterPricingRules(),
		productMasterVariants: r.many.productMasterVariants(),
		productMasterVersions: r.many.productMasterVersions({
			from: r.productMasters.id.through(r.productMasterVersions.masterId),
			to: r.productMasterVersions.id.through(r.productMasterVersions.parentVersionId)
		}),
		productOptionGroupDisplays: r.many.productOptionGroupDisplays(),
		productOptionValueDisplays: r.many.productOptionValueDisplays(),
		productTagValues: r.many.productTagValues(),
		promotionProducts: r.many.promotionProducts(),
	},
	productVariants: {
		salesChannels: r.many.salesChannels(),
		productMasterVariants: r.many.productMasterVariants(),
		productMasterVersions: r.many.productMasterVersions({
			from: r.productVariants.id.through(r.productVariantPriceCache.variantId),
			to: r.productMasterVersions.id.through(r.productVariantPriceCache.versionId)
		}),
		promotionProducts: r.many.promotionProducts(),
		productOptionValues: r.many.productOptionValues(),
	},
	productApprovalHistory: {
		productMasterVersion: r.one.productMasterVersions({
			from: r.productApprovalHistory.versionId,
			to: r.productMasterVersions.id
		}),
	},
	productMasterVersions: {
		productApprovalHistories: r.many.productApprovalHistory(),
		productImages: r.many.productImages(),
		productMasterCategories: r.many.productMasterCategories(),
		productMasterOptionGroups: r.many.productMasterOptionGroups(),
		productMasterPricingRules: r.many.productMasterPricingRules(),
		productMasterVariants: r.many.productMasterVariants(),
		productMasters: r.many.productMasters(),
		productOptionGroupDisplays: r.many.productOptionGroupDisplays(),
		productOptionValueDisplays: r.many.productOptionValueDisplays(),
		productTagValues: r.many.productTagValues(),
		productVariants: r.many.productVariants(),
	},
	productImages: {
		productMasterVersion: r.one.productMasterVersions({
			from: r.productImages.versionId,
			to: r.productMasterVersions.id
		}),
	},
	productMasterCategories: {
		productCategory: r.one.productCategories({
			from: r.productMasterCategories.categoryId,
			to: r.productCategories.id
		}),
		productMaster: r.one.productMasters({
			from: r.productMasterCategories.masterId,
			to: r.productMasters.id
		}),
		productMasterVersion: r.one.productMasterVersions({
			from: r.productMasterCategories.versionId,
			to: r.productMasterVersions.id
		}),
	},
	productMasterOptionGroups: {
		productMaster: r.one.productMasters({
			from: r.productMasterOptionGroups.masterId,
			to: r.productMasters.id
		}),
		productOptionGroup: r.one.productOptionGroups({
			from: r.productMasterOptionGroups.optionGroupId,
			to: r.productOptionGroups.id
		}),
		productMasterVersion: r.one.productMasterVersions({
			from: r.productMasterOptionGroups.versionId,
			to: r.productMasterVersions.id
		}),
	},
	productOptionGroups: {
		productMasterOptionGroups: r.many.productMasterOptionGroups(),
		productOptionGroupDisplays: r.many.productOptionGroupDisplays(),
		productOptionValues: r.many.productOptionValues(),
	},
	productMasterPricingRules: {
		productMaster: r.one.productMasters({
			from: r.productMasterPricingRules.masterId,
			to: r.productMasters.id
		}),
		pricingRule: r.one.pricingRules({
			from: r.productMasterPricingRules.pricingRuleId,
			to: r.pricingRules.id
		}),
		productMasterVersion: r.one.productMasterVersions({
			from: r.productMasterPricingRules.versionId,
			to: r.productMasterVersions.id
		}),
	},
	pricingRules: {
		productMasterPricingRules: r.many.productMasterPricingRules(),
	},
	productMasterVariants: {
		productMaster: r.one.productMasters({
			from: r.productMasterVariants.masterId,
			to: r.productMasters.id
		}),
		productVariant: r.one.productVariants({
			from: r.productMasterVariants.variantId,
			to: r.productVariants.id
		}),
		productMasterVersion: r.one.productMasterVersions({
			from: r.productMasterVariants.versionId,
			to: r.productMasterVersions.id
		}),
	},
	productOptionGroupDisplays: {
		productMaster: r.one.productMasters({
			from: r.productOptionGroupDisplays.masterId,
			to: r.productMasters.id
		}),
		productOptionGroup: r.one.productOptionGroups({
			from: r.productOptionGroupDisplays.optionGroupId,
			to: r.productOptionGroups.id
		}),
		productMasterVersion: r.one.productMasterVersions({
			from: r.productOptionGroupDisplays.versionId,
			to: r.productMasterVersions.id
		}),
	},
	productOptionValueDisplays: {
		productMaster: r.one.productMasters({
			from: r.productOptionValueDisplays.masterId,
			to: r.productMasters.id
		}),
		productOptionValue: r.one.productOptionValues({
			from: r.productOptionValueDisplays.optionValueId,
			to: r.productOptionValues.id
		}),
		productMasterVersion: r.one.productMasterVersions({
			from: r.productOptionValueDisplays.versionId,
			to: r.productMasterVersions.id
		}),
	},
	productOptionValues: {
		productOptionValueDisplays: r.many.productOptionValueDisplays(),
		productOptionGroup: r.one.productOptionGroups({
			from: r.productOptionValues.optionGroupId,
			to: r.productOptionGroups.id
		}),
		productVariants: r.many.productVariants({
			from: r.productOptionValues.id.through(r.variantOptionValues.optionValueId),
			to: r.productVariants.id.through(r.variantOptionValues.variantId)
		}),
	},
	productTagValues: {
		productMaster: r.one.productMasters({
			from: r.productTagValues.masterId,
			to: r.productMasters.id
		}),
		tagValue: r.one.tagValues({
			from: r.productTagValues.tagValueId,
			to: r.tagValues.id
		}),
		productMasterVersion: r.one.productMasterVersions({
			from: r.productTagValues.versionId,
			to: r.productMasterVersions.id
		}),
	},
	tagValues: {
		productTagValues: r.many.productTagValues(),
		tagGroup: r.one.tagGroups({
			from: r.tagValues.groupId,
			to: r.tagGroups.id
		}),
	},
	promotionProducts: {
		productMaster: r.one.productMasters({
			from: r.promotionProducts.masterId,
			to: r.productMasters.id
		}),
		promotion: r.one.promotions({
			from: r.promotionProducts.promotionId,
			to: r.promotions.id
		}),
		productVariant: r.one.productVariants({
			from: r.promotionProducts.variantId,
			to: r.productVariants.id
		}),
	},
	promotions: {
		promotionProducts: r.many.promotionProducts(),
	},
	channelCategories: {
		salesChannels: r.many.salesChannels(),
	},
}))