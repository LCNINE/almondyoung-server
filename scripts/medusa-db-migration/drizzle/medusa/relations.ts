import { defineRelations } from "drizzle-orm";
import * as schema from "./schema";

export const relations = defineRelations(schema, (r) => ({
	promotionApplicationMethod: {
		promotionRulesViaApplicationMethodBuyRules: r.many.promotionRule({
			from: r.promotionApplicationMethod.id.through(r.applicationMethodBuyRules.applicationMethodId),
			to: r.promotionRule.id.through(r.applicationMethodBuyRules.promotionRuleId),
			alias: "promotionApplicationMethod_id_promotionRule_id_via_applicationMethodBuyRules"
		}),
		promotionRulesViaApplicationMethodTargetRules: r.many.promotionRule({
			from: r.promotionApplicationMethod.id.through(r.applicationMethodTargetRules.applicationMethodId),
			to: r.promotionRule.id.through(r.applicationMethodTargetRules.promotionRuleId),
			alias: "promotionApplicationMethod_id_promotionRule_id_via_applicationMethodTargetRules"
		}),
		promotion: r.one.promotion({
			from: r.promotionApplicationMethod.promotionId,
			to: r.promotion.id
		}),
	},
	promotionRule: {
		promotionApplicationMethodsViaApplicationMethodBuyRules: r.many.promotionApplicationMethod({
			alias: "promotionApplicationMethod_id_promotionRule_id_via_applicationMethodBuyRules"
		}),
		promotionApplicationMethodsViaApplicationMethodTargetRules: r.many.promotionApplicationMethod({
			alias: "promotionApplicationMethod_id_promotionRule_id_via_applicationMethodTargetRules"
		}),
		promotions: r.many.promotion(),
		promotionRuleValues: r.many.promotionRuleValue(),
	},
	capture: {
		payment: r.one.payment({
			from: r.capture.paymentId,
			to: r.payment.id
		}),
	},
	payment: {
		captures: r.many.capture(),
		paymentCollection: r.one.paymentCollection({
			from: r.payment.paymentCollectionId,
			to: r.paymentCollection.id
		}),
		refunds: r.many.refund(),
	},
	cartLineItem: {
		cart: r.one.cart({
			from: r.cartLineItem.cartId,
			to: r.cart.id
		}),
		cartLineItemAdjustments: r.many.cartLineItemAdjustment(),
		cartLineItemTaxLines: r.many.cartLineItemTaxLine(),
	},
	cart: {
		cartLineItems: r.many.cartLineItem(),
		cartShippingMethods: r.many.cartShippingMethod(),
		creditLines: r.many.creditLine(),
	},
	cartLineItemAdjustment: {
		cartLineItem: r.one.cartLineItem({
			from: r.cartLineItemAdjustment.itemId,
			to: r.cartLineItem.id
		}),
	},
	cartLineItemTaxLine: {
		cartLineItem: r.one.cartLineItem({
			from: r.cartLineItemTaxLine.itemId,
			to: r.cartLineItem.id
		}),
	},
	cartShippingMethod: {
		cart: r.one.cart({
			from: r.cartShippingMethod.cartId,
			to: r.cart.id
		}),
		cartShippingMethodAdjustments: r.many.cartShippingMethodAdjustment(),
		cartShippingMethodTaxLines: r.many.cartShippingMethodTaxLine(),
	},
	cartShippingMethodAdjustment: {
		cartShippingMethod: r.one.cartShippingMethod({
			from: r.cartShippingMethodAdjustment.shippingMethodId,
			to: r.cartShippingMethod.id
		}),
	},
	cartShippingMethodTaxLine: {
		cartShippingMethod: r.one.cartShippingMethod({
			from: r.cartShippingMethodTaxLine.shippingMethodId,
			to: r.cartShippingMethod.id
		}),
	},
	creditLine: {
		cart: r.one.cart({
			from: r.creditLine.cartId,
			to: r.cart.id
		}),
	},
	customerAddress: {
		customer: r.one.customer({
			from: r.customerAddress.customerId,
			to: r.customer.id
		}),
	},
	customer: {
		customerAddresses: r.many.customerAddress(),
		customerGroups: r.many.customerGroup(),
	},
	customerGroup: {
		customers: r.many.customer({
			from: r.customerGroup.id.through(r.customerGroupCustomer.customerGroupId),
			to: r.customer.id.through(r.customerGroupCustomer.customerId)
		}),
	},
	fulfillment: {
		fulfillmentAddress: r.one.fulfillmentAddress({
			from: r.fulfillment.deliveryAddressId,
			to: r.fulfillmentAddress.id
		}),
		fulfillmentProvider: r.one.fulfillmentProvider({
			from: r.fulfillment.providerId,
			to: r.fulfillmentProvider.id
		}),
		shippingOption: r.one.shippingOption({
			from: r.fulfillment.shippingOptionId,
			to: r.shippingOption.id
		}),
		fulfillmentItems: r.many.fulfillmentItem(),
		fulfillmentLabels: r.many.fulfillmentLabel(),
	},
	fulfillmentAddress: {
		fulfillments: r.many.fulfillment(),
	},
	fulfillmentProvider: {
		fulfillments: r.many.fulfillment(),
		shippingOptions: r.many.shippingOption(),
	},
	shippingOption: {
		fulfillments: r.many.fulfillment(),
		fulfillmentProvider: r.one.fulfillmentProvider({
			from: r.shippingOption.providerId,
			to: r.fulfillmentProvider.id
		}),
		serviceZone: r.one.serviceZone({
			from: r.shippingOption.serviceZoneId,
			to: r.serviceZone.id
		}),
		shippingOptionType: r.one.shippingOptionType({
			from: r.shippingOption.shippingOptionTypeId,
			to: r.shippingOptionType.id
		}),
		shippingProfile: r.one.shippingProfile({
			from: r.shippingOption.shippingProfileId,
			to: r.shippingProfile.id
		}),
		shippingOptionRules: r.many.shippingOptionRule(),
	},
	fulfillmentItem: {
		fulfillment: r.one.fulfillment({
			from: r.fulfillmentItem.fulfillmentId,
			to: r.fulfillment.id
		}),
	},
	fulfillmentLabel: {
		fulfillment: r.one.fulfillment({
			from: r.fulfillmentLabel.fulfillmentId,
			to: r.fulfillment.id
		}),
	},
	geoZone: {
		serviceZone: r.one.serviceZone({
			from: r.geoZone.serviceZoneId,
			to: r.serviceZone.id
		}),
	},
	serviceZone: {
		geoZones: r.many.geoZone(),
		fulfillmentSet: r.one.fulfillmentSet({
			from: r.serviceZone.fulfillmentSetId,
			to: r.fulfillmentSet.id
		}),
		shippingOptions: r.many.shippingOption(),
	},
	image: {
		product: r.one.product({
			from: r.image.productId,
			to: r.product.id
		}),
		productVariantProductImages: r.many.productVariantProductImage(),
	},
	product: {
		images: r.many.image(),
		productCategories: r.many.productCategory(),
		productOptions: r.many.productOption(),
		productTags: r.many.productTag({
			from: r.product.id.through(r.productTags.productId),
			to: r.productTag.id.through(r.productTags.productTagId)
		}),
		productVariants: r.many.productVariant(),
	},
	inventoryLevel: {
		inventoryItem: r.one.inventoryItem({
			from: r.inventoryLevel.inventoryItemId,
			to: r.inventoryItem.id
		}),
	},
	inventoryItem: {
		inventoryLevels: r.many.inventoryLevel(),
		reservationItems: r.many.reservationItem(),
	},
	notification: {
		notificationProvider: r.one.notificationProvider({
			from: r.notification.providerId,
			to: r.notificationProvider.id
		}),
	},
	notificationProvider: {
		notifications: r.many.notification(),
	},
	orderChange: {
		order: r.one.order({
			from: r.orderChange.orderId,
			to: r.order.id
		}),
		orderChangeActions: r.many.orderChangeAction(),
	},
	order: {
		orderChanges: r.many.orderChange(),
		orderCreditLines: r.many.orderCreditLine(),
		orderLineItems: r.many.orderLineItem(),
		orderShippings: r.many.orderShipping(),
		orderSummaries: r.many.orderSummary(),
		orderTransactions: r.many.orderTransaction(),
	},
	orderChangeAction: {
		orderChange: r.one.orderChange({
			from: r.orderChangeAction.orderChangeId,
			to: r.orderChange.id
		}),
	},
	orderCreditLine: {
		order: r.one.order({
			from: r.orderCreditLine.orderId,
			to: r.order.id
		}),
	},
	orderLineItem: {
		orders: r.many.order({
			from: r.orderLineItem.id.through(r.orderItem.itemId),
			to: r.order.id.through(r.orderItem.orderId)
		}),
		orderItem: r.one.orderItem({
			from: r.orderLineItem.totalsId,
			to: r.orderItem.id
		}),
		orderLineItemAdjustments: r.many.orderLineItemAdjustment(),
		orderLineItemTaxLines: r.many.orderLineItemTaxLine(),
	},
	orderItem: {
		orderLineItems: r.many.orderLineItem(),
	},
	orderLineItemAdjustment: {
		orderLineItem: r.one.orderLineItem({
			from: r.orderLineItemAdjustment.itemId,
			to: r.orderLineItem.id
		}),
	},
	orderLineItemTaxLine: {
		orderLineItem: r.one.orderLineItem({
			from: r.orderLineItemTaxLine.itemId,
			to: r.orderLineItem.id
		}),
	},
	orderShipping: {
		order: r.one.order({
			from: r.orderShipping.orderId,
			to: r.order.id
		}),
	},
	orderShippingMethodAdjustment: {
		orderShippingMethod: r.one.orderShippingMethod({
			from: r.orderShippingMethodAdjustment.shippingMethodId,
			to: r.orderShippingMethod.id
		}),
	},
	orderShippingMethod: {
		orderShippingMethodAdjustments: r.many.orderShippingMethodAdjustment(),
		orderShippingMethodTaxLines: r.many.orderShippingMethodTaxLine(),
	},
	orderShippingMethodTaxLine: {
		orderShippingMethod: r.one.orderShippingMethod({
			from: r.orderShippingMethodTaxLine.shippingMethodId,
			to: r.orderShippingMethod.id
		}),
	},
	orderSummary: {
		order: r.one.order({
			from: r.orderSummary.orderId,
			to: r.order.id
		}),
	},
	orderTransaction: {
		order: r.one.order({
			from: r.orderTransaction.orderId,
			to: r.order.id
		}),
	},
	paymentCollection: {
		payments: r.many.payment(),
		paymentProviders: r.many.paymentProvider({
			from: r.paymentCollection.id.through(r.paymentCollectionPaymentProviders.paymentCollectionId),
			to: r.paymentProvider.id.through(r.paymentCollectionPaymentProviders.paymentProviderId)
		}),
		paymentSessions: r.many.paymentSession(),
	},
	paymentProvider: {
		paymentCollections: r.many.paymentCollection(),
	},
	paymentSession: {
		paymentCollection: r.one.paymentCollection({
			from: r.paymentSession.paymentCollectionId,
			to: r.paymentCollection.id
		}),
	},
	priceList: {
		priceSets: r.many.priceSet({
			from: r.priceList.id.through(r.price.priceListId),
			to: r.priceSet.id.through(r.price.priceSetId)
		}),
		priceListRules: r.many.priceListRule(),
	},
	priceSet: {
		priceLists: r.many.priceList(),
	},
	priceListRule: {
		priceList: r.one.priceList({
			from: r.priceListRule.priceListId,
			to: r.priceList.id
		}),
	},
	priceRule: {
		price: r.one.price({
			from: r.priceRule.priceId,
			to: r.price.id
		}),
	},
	price: {
		priceRules: r.many.priceRule(),
	},
	productCollection: {
		productTypes: r.many.productType({
			from: r.productCollection.id.through(r.product.collectionId),
			to: r.productType.id.through(r.product.typeId)
		}),
	},
	productType: {
		productCollections: r.many.productCollection(),
	},
	productCategory: {
		productCategory: r.one.productCategory({
			from: r.productCategory.parentCategoryId,
			to: r.productCategory.id,
			alias: "productCategory_parentCategoryId_productCategory_id"
		}),
		productCategories: r.many.productCategory({
			alias: "productCategory_parentCategoryId_productCategory_id"
		}),
		products: r.many.product({
			from: r.productCategory.id.through(r.productCategoryProduct.productCategoryId),
			to: r.product.id.through(r.productCategoryProduct.productId)
		}),
	},
	productOption: {
		product: r.one.product({
			from: r.productOption.productId,
			to: r.product.id
		}),
		productOptionValues: r.many.productOptionValue(),
	},
	productOptionValue: {
		productOption: r.one.productOption({
			from: r.productOptionValue.optionId,
			to: r.productOption.id
		}),
		productVariants: r.many.productVariant({
			from: r.productOptionValue.id.through(r.productVariantOption.optionValueId),
			to: r.productVariant.id.through(r.productVariantOption.variantId)
		}),
	},
	productTag: {
		products: r.many.product(),
	},
	productVariant: {
		product: r.one.product({
			from: r.productVariant.productId,
			to: r.product.id
		}),
		productOptionValues: r.many.productOptionValue(),
	},
	productVariantProductImage: {
		image: r.one.image({
			from: r.productVariantProductImage.imageId,
			to: r.image.id
		}),
	},
	promotion: {
		promotionCampaign: r.one.promotionCampaign({
			from: r.promotion.campaignId,
			to: r.promotionCampaign.id
		}),
		promotionApplicationMethods: r.many.promotionApplicationMethod(),
		promotionRules: r.many.promotionRule({
			from: r.promotion.id.through(r.promotionPromotionRule.promotionId),
			to: r.promotionRule.id.through(r.promotionPromotionRule.promotionRuleId)
		}),
	},
	promotionCampaign: {
		promotions: r.many.promotion(),
		promotionCampaignBudgets: r.many.promotionCampaignBudget(),
	},
	promotionCampaignBudget: {
		promotionCampaign: r.one.promotionCampaign({
			from: r.promotionCampaignBudget.campaignId,
			to: r.promotionCampaign.id
		}),
		promotionCampaignBudgetUsages: r.many.promotionCampaignBudgetUsage(),
	},
	promotionCampaignBudgetUsage: {
		promotionCampaignBudget: r.one.promotionCampaignBudget({
			from: r.promotionCampaignBudgetUsage.budgetId,
			to: r.promotionCampaignBudget.id
		}),
	},
	promotionRuleValue: {
		promotionRule: r.one.promotionRule({
			from: r.promotionRuleValue.promotionRuleId,
			to: r.promotionRule.id
		}),
	},
	providerIdentity: {
		authIdentity: r.one.authIdentity({
			from: r.providerIdentity.authIdentityId,
			to: r.authIdentity.id
		}),
	},
	authIdentity: {
		providerIdentities: r.many.providerIdentity(),
	},
	refund: {
		payment: r.one.payment({
			from: r.refund.paymentId,
			to: r.payment.id
		}),
	},
	regionCountry: {
		region: r.one.region({
			from: r.regionCountry.regionId,
			to: r.region.id
		}),
	},
	region: {
		regionCountries: r.many.regionCountry(),
	},
	reservationItem: {
		inventoryItem: r.one.inventoryItem({
			from: r.reservationItem.inventoryItemId,
			to: r.inventoryItem.id
		}),
	},
	returnReason: {
		returnReason: r.one.returnReason({
			from: r.returnReason.parentReturnReasonId,
			to: r.returnReason.id,
			alias: "returnReason_parentReturnReasonId_returnReason_id"
		}),
		returnReasons: r.many.returnReason({
			alias: "returnReason_parentReturnReasonId_returnReason_id"
		}),
	},
	fulfillmentSet: {
		serviceZones: r.many.serviceZone(),
	},
	shippingOptionType: {
		shippingOptions: r.many.shippingOption(),
	},
	shippingProfile: {
		shippingOptions: r.many.shippingOption(),
	},
	shippingOptionRule: {
		shippingOption: r.one.shippingOption({
			from: r.shippingOptionRule.shippingOptionId,
			to: r.shippingOption.id
		}),
	},
	stockLocation: {
		stockLocationAddress: r.one.stockLocationAddress({
			from: r.stockLocation.addressId,
			to: r.stockLocationAddress.id
		}),
	},
	stockLocationAddress: {
		stockLocations: r.many.stockLocation(),
	},
	storeCurrency: {
		store: r.one.store({
			from: r.storeCurrency.storeId,
			to: r.store.id
		}),
	},
	store: {
		storeCurrencies: r.many.storeCurrency(),
	},
	taxRate: {
		taxRegion: r.one.taxRegion({
			from: r.taxRate.taxRegionId,
			to: r.taxRegion.id
		}),
		taxRateRules: r.many.taxRateRule(),
	},
	taxRegion: {
		taxRates: r.many.taxRate(),
		taxProviders: r.many.taxProvider({
			from: r.taxRegion.id.through(r.taxRegion.parentId),
			to: r.taxProvider.id.through(r.taxRegion.providerId)
		}),
	},
	taxRateRule: {
		taxRate: r.one.taxRate({
			from: r.taxRateRule.taxRateId,
			to: r.taxRate.id
		}),
	},
	taxProvider: {
		taxRegions: r.many.taxRegion(),
	},
}))