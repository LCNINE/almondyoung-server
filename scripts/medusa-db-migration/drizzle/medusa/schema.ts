import { pgEnum, pgTable, text, varchar, serial, boolean, jsonb, numeric, timestamp, real, integer, json, bigserial, index, uniqueIndex, foreignKey, type AnyPgColumn, primaryKey, unique, check } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const claimReasonEnum = pgEnum("claim_reason_enum", ["missing_item", "wrong_item", "production_failure", "other"])
export const orderClaimTypeEnum = pgEnum("order_claim_type_enum", ["refund", "replace"])
export const orderStatusEnum = pgEnum("order_status_enum", ["pending", "completed", "draft", "archived", "canceled", "requires_action"])
export const returnStatusEnum = pgEnum("return_status_enum", ["open", "requested", "received", "partially_received", "canceled"])


export const accountHolder = pgTable("account_holder", {
  id: text().primaryKey(),
  providerId: text("provider_id").notNull(),
  externalId: text("external_id").notNull(),
  email: text(),
  data: jsonb().default({}).notNull(),
  metadata: jsonb(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("IDX_account_holder_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  uniqueIndex("IDX_account_holder_provider_id_external_id_unique").using("btree", table.providerId.asc().nullsLast(), table.externalId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const apiKey = pgTable("api_key", {
  id: text().primaryKey(),
  token: text().notNull(),
  salt: text().notNull(),
  redacted: text().notNull(),
  title: text().notNull(),
  type: text().notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  revokedBy: text("revoked_by"),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("IDX_api_key_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_api_key_redacted").using("btree", table.redacted.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_api_key_revoked_at").using("btree", table.revokedAt.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  uniqueIndex("IDX_api_key_token_unique").using("btree", table.token.asc().nullsLast()),
  index("IDX_api_key_type").using("btree", table.type.asc().nullsLast()),
  check("api_key_type_check", sql`(type = ANY (ARRAY['publishable'::text, 'secret'::text]))`),]);

export const applicationMethodBuyRules = pgTable("application_method_buy_rules", {
  applicationMethodId: text("application_method_id").notNull().references(() => promotionApplicationMethod.id, { onDelete: "cascade", onUpdate: "cascade" }),
  promotionRuleId: text("promotion_rule_id").notNull().references(() => promotionRule.id, { onDelete: "cascade", onUpdate: "cascade" }),
}, (table) => [
  primaryKey({ columns: [table.applicationMethodId, table.promotionRuleId], name: "application_method_buy_rules_pkey" }),
]);

export const applicationMethodTargetRules = pgTable("application_method_target_rules", {
  applicationMethodId: text("application_method_id").notNull().references(() => promotionApplicationMethod.id, { onDelete: "cascade", onUpdate: "cascade" }),
  promotionRuleId: text("promotion_rule_id").notNull().references(() => promotionRule.id, { onDelete: "cascade", onUpdate: "cascade" }),
}, (table) => [
  primaryKey({ columns: [table.applicationMethodId, table.promotionRuleId], name: "application_method_target_rules_pkey" }),
]);

export const authIdentity = pgTable("auth_identity", {
  id: text().primaryKey(),
  appMetadata: jsonb("app_metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("IDX_auth_identity_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const capture = pgTable("capture", {
  id: text().primaryKey(),
  amount: numeric().notNull(),
  rawAmount: jsonb("raw_amount").notNull(),
  paymentId: text("payment_id").notNull().references(() => payment.id, { onDelete: "cascade", onUpdate: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdBy: text("created_by"),
  metadata: jsonb(),
}, (table) => [
  index("IDX_capture_deleted_at").using("btree", table.deletedAt.asc().nullsLast()),
  index("IDX_capture_payment_id").using("btree", table.paymentId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const cart = pgTable("cart", {
  id: text().primaryKey(),
  regionId: text("region_id"),
  customerId: text("customer_id"),
  salesChannelId: text("sales_channel_id"),
  email: text(),
  currencyCode: text("currency_code").notNull(),
  shippingAddressId: text("shipping_address_id").references(() => cartAddress.id, { onDelete: "set null", onUpdate: "cascade" }),
  billingAddressId: text("billing_address_id").references(() => cartAddress.id, { onDelete: "set null", onUpdate: "cascade" }),
  metadata: jsonb(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  index("IDX_cart_billing_address_id").using("btree", table.billingAddressId.asc().nullsLast()).where(sql`((deleted_at IS NULL) AND (billing_address_id IS NOT NULL))`),
  index("IDX_cart_currency_code").using("btree", table.currencyCode.asc().nullsLast()),
  index("IDX_cart_customer_id").using("btree", table.customerId.asc().nullsLast()).where(sql`((deleted_at IS NULL) AND (customer_id IS NOT NULL))`),
  index("IDX_cart_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NOT NULL)`),
  index("IDX_cart_region_id").using("btree", table.regionId.asc().nullsLast()).where(sql`((deleted_at IS NULL) AND (region_id IS NOT NULL))`),
  index("IDX_cart_sales_channel_id").using("btree", table.salesChannelId.asc().nullsLast()).where(sql`((deleted_at IS NULL) AND (sales_channel_id IS NOT NULL))`),
  index("IDX_cart_shipping_address_id").using("btree", table.shippingAddressId.asc().nullsLast()).where(sql`((deleted_at IS NULL) AND (shipping_address_id IS NOT NULL))`),
]);

export const cartAddress = pgTable("cart_address", {
  id: text().primaryKey(),
  customerId: text("customer_id"),
  company: text(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  address1: text("address_1"),
  address2: text("address_2"),
  city: text(),
  countryCode: text("country_code"),
  province: text(),
  postalCode: text("postal_code"),
  phone: text(),
  metadata: jsonb(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("IDX_cart_address_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NOT NULL)`),
]);

export const cartLineItem = pgTable("cart_line_item", {
  id: text().primaryKey(),
  cartId: text("cart_id").notNull().references(() => cart.id, { onDelete: "cascade", onUpdate: "cascade" }),
  title: text().notNull(),
  subtitle: text(),
  thumbnail: text(),
  quantity: integer().notNull(),
  variantId: text("variant_id"),
  productId: text("product_id"),
  productTitle: text("product_title"),
  productDescription: text("product_description"),
  productSubtitle: text("product_subtitle"),
  productType: text("product_type"),
  productCollection: text("product_collection"),
  productHandle: text("product_handle"),
  variantSku: text("variant_sku"),
  variantBarcode: text("variant_barcode"),
  variantTitle: text("variant_title"),
  variantOptionValues: jsonb("variant_option_values"),
  requiresShipping: boolean("requires_shipping").default(true).notNull(),
  isDiscountable: boolean("is_discountable").default(true).notNull(),
  isTaxInclusive: boolean("is_tax_inclusive").default(false).notNull(),
  compareAtUnitPrice: numeric("compare_at_unit_price"),
  rawCompareAtUnitPrice: jsonb("raw_compare_at_unit_price"),
  unitPrice: numeric("unit_price").notNull(),
  rawUnitPrice: jsonb("raw_unit_price").notNull(),
  metadata: jsonb(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  productTypeId: text("product_type_id"),
  isCustomPrice: boolean("is_custom_price").default(false).notNull(),
  isGiftcard: boolean("is_giftcard").default(false).notNull(),
}, (table) => [
  index("IDX_cart_line_item_cart_id").using("btree", table.cartId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_cart_line_item_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NOT NULL)`),
  index("IDX_line_item_product_id").using("btree", table.productId.asc().nullsLast()).where(sql`((deleted_at IS NULL) AND (product_id IS NOT NULL))`),
  index("IDX_line_item_variant_id").using("btree", table.variantId.asc().nullsLast()).where(sql`((deleted_at IS NULL) AND (variant_id IS NOT NULL))`),
  check("cart_line_item_unit_price_check", sql`(unit_price >= (0)::numeric)`),]);

export const cartLineItemAdjustment = pgTable("cart_line_item_adjustment", {
  id: text().primaryKey(),
  description: text(),
  promotionId: text("promotion_id"),
  code: text(),
  amount: numeric().notNull(),
  rawAmount: jsonb("raw_amount").notNull(),
  providerId: text("provider_id"),
  metadata: jsonb(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  itemId: text("item_id").references(() => cartLineItem.id, { onDelete: "cascade", onUpdate: "cascade" }),
  isTaxInclusive: boolean("is_tax_inclusive").default(false).notNull(),
}, (table) => [
  index("IDX_cart_line_item_adjustment_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NOT NULL)`),
  index("IDX_cart_line_item_adjustment_item_id").using("btree", table.itemId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_line_item_adjustment_promotion_id").using("btree", table.promotionId.asc().nullsLast()).where(sql`((deleted_at IS NULL) AND (promotion_id IS NOT NULL))`),
  check("cart_line_item_adjustment_check", sql`(amount >= (0)::numeric)`),]);

export const cartLineItemTaxLine = pgTable("cart_line_item_tax_line", {
  id: text().primaryKey(),
  description: text(),
  taxRateId: text("tax_rate_id"),
  code: text().notNull(),
  rate: real().notNull(),
  providerId: text("provider_id"),
  metadata: jsonb(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  itemId: text("item_id").references(() => cartLineItem.id, { onDelete: "cascade", onUpdate: "cascade" }),
}, (table) => [
  index("IDX_cart_line_item_tax_line_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NOT NULL)`),
  index("IDX_cart_line_item_tax_line_item_id").using("btree", table.itemId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_line_item_tax_line_tax_rate_id").using("btree", table.taxRateId.asc().nullsLast()).where(sql`((deleted_at IS NULL) AND (tax_rate_id IS NOT NULL))`),
]);

export const cartPaymentCollection = pgTable("cart_payment_collection", {
  cartId: varchar("cart_id", { length: 255 }).notNull(),
  paymentCollectionId: varchar("payment_collection_id", { length: 255 }).notNull(),
  id: varchar({ length: 255 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  primaryKey({ columns: [table.cartId, table.paymentCollectionId], name: "cart_payment_collection_pkey" }),
  index("IDX_cart_id_-4a39f6c9").using("btree", table.cartId.asc().nullsLast()),
  index("IDX_deleted_at_-4a39f6c9").using("btree", table.deletedAt.asc().nullsLast()),
  index("IDX_id_-4a39f6c9").using("btree", table.id.asc().nullsLast()),
  index("IDX_payment_collection_id_-4a39f6c9").using("btree", table.paymentCollectionId.asc().nullsLast()),
]);

export const cartPromotion = pgTable("cart_promotion", {
  cartId: varchar("cart_id", { length: 255 }).notNull(),
  promotionId: varchar("promotion_id", { length: 255 }).notNull(),
  id: varchar({ length: 255 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  primaryKey({ columns: [table.cartId, table.promotionId], name: "cart_promotion_pkey" }),
  index("IDX_cart_id_-a9d4a70b").using("btree", table.cartId.asc().nullsLast()),
  index("IDX_deleted_at_-a9d4a70b").using("btree", table.deletedAt.asc().nullsLast()),
  index("IDX_id_-a9d4a70b").using("btree", table.id.asc().nullsLast()),
  index("IDX_promotion_id_-a9d4a70b").using("btree", table.promotionId.asc().nullsLast()),
]);

export const cartShippingMethod = pgTable("cart_shipping_method", {
  id: text().primaryKey(),
  cartId: text("cart_id").notNull().references(() => cart.id, { onDelete: "cascade", onUpdate: "cascade" }),
  name: text().notNull(),
  description: jsonb(),
  amount: numeric().notNull(),
  rawAmount: jsonb("raw_amount").notNull(),
  isTaxInclusive: boolean("is_tax_inclusive").default(false).notNull(),
  shippingOptionId: text("shipping_option_id"),
  data: jsonb(),
  metadata: jsonb(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("IDX_cart_shipping_method_cart_id").using("btree", table.cartId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_cart_shipping_method_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NOT NULL)`),
  index("IDX_shipping_method_option_id").using("btree", table.shippingOptionId.asc().nullsLast()).where(sql`((deleted_at IS NULL) AND (shipping_option_id IS NOT NULL))`),
  check("cart_shipping_method_check", sql`(amount >= (0)::numeric)`),]);

export const cartShippingMethodAdjustment = pgTable("cart_shipping_method_adjustment", {
  id: text().primaryKey(),
  description: text(),
  promotionId: text("promotion_id"),
  code: text(),
  amount: numeric().notNull(),
  rawAmount: jsonb("raw_amount").notNull(),
  providerId: text("provider_id"),
  metadata: jsonb(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  shippingMethodId: text("shipping_method_id").references(() => cartShippingMethod.id, { onDelete: "cascade", onUpdate: "cascade" }),
}, (table) => [
  index("IDX_cart_shipping_method_adjustment_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NOT NULL)`),
  index("IDX_cart_shipping_method_adjustment_shipping_method_id").using("btree", table.shippingMethodId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_shipping_method_adjustment_promotion_id").using("btree", table.promotionId.asc().nullsLast()).where(sql`((deleted_at IS NULL) AND (promotion_id IS NOT NULL))`),
]);

export const cartShippingMethodTaxLine = pgTable("cart_shipping_method_tax_line", {
  id: text().primaryKey(),
  description: text(),
  taxRateId: text("tax_rate_id"),
  code: text().notNull(),
  rate: real().notNull(),
  providerId: text("provider_id"),
  metadata: jsonb(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  shippingMethodId: text("shipping_method_id").references(() => cartShippingMethod.id, { onDelete: "cascade", onUpdate: "cascade" }),
}, (table) => [
  index("IDX_cart_shipping_method_tax_line_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NOT NULL)`),
  index("IDX_cart_shipping_method_tax_line_shipping_method_id").using("btree", table.shippingMethodId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_shipping_method_tax_line_tax_rate_id").using("btree", table.taxRateId.asc().nullsLast()).where(sql`((deleted_at IS NULL) AND (tax_rate_id IS NOT NULL))`),
]);

export const creditLine = pgTable("credit_line", {
  id: text().primaryKey(),
  cartId: text("cart_id").notNull().references(() => cart.id, { onUpdate: "cascade" }),
  reference: text(),
  referenceId: text("reference_id"),
  amount: numeric().notNull(),
  rawAmount: jsonb("raw_amount").notNull(),
  metadata: jsonb(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("IDX_cart_credit_line_reference_reference_id").using("btree", table.reference.asc().nullsLast(), table.referenceId.asc().nullsLast()).where(sql`(deleted_at IS NOT NULL)`),
  index("IDX_credit_line_cart_id").using("btree", table.cartId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_credit_line_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const currency = pgTable("currency", {
  code: text().primaryKey(),
  symbol: text().notNull(),
  symbolNative: text("symbol_native").notNull(),
  decimalDigits: integer("decimal_digits").default(0).notNull(),
  rounding: numeric({ mode: 'number' }).default(0).notNull(),
  rawRounding: jsonb("raw_rounding").notNull(),
  name: text().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const customer = pgTable("customer", {
  id: text().primaryKey(),
  companyName: text("company_name"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  email: text(),
  phone: text(),
  hasAccount: boolean("has_account").default(false).notNull(),
  metadata: jsonb(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdBy: text("created_by"),
}, (table) => [
  index("IDX_customer_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  uniqueIndex("IDX_customer_email_has_account_unique").using("btree", table.email.asc().nullsLast(), table.hasAccount.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const customerAccountHolder = pgTable("customer_account_holder", {
  customerId: varchar("customer_id", { length: 255 }).notNull(),
  accountHolderId: varchar("account_holder_id", { length: 255 }).notNull(),
  id: varchar({ length: 255 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  primaryKey({ columns: [table.customerId, table.accountHolderId], name: "customer_account_holder_pkey" }),
  index("IDX_account_holder_id_5cb3a0c0").using("btree", table.accountHolderId.asc().nullsLast()),
  index("IDX_customer_id_5cb3a0c0").using("btree", table.customerId.asc().nullsLast()),
  index("IDX_deleted_at_5cb3a0c0").using("btree", table.deletedAt.asc().nullsLast()),
  index("IDX_id_5cb3a0c0").using("btree", table.id.asc().nullsLast()),
]);

export const customerAddress = pgTable("customer_address", {
  id: text().primaryKey(),
  customerId: text("customer_id").notNull().references(() => customer.id, { onDelete: "cascade", onUpdate: "cascade" }),
  addressName: text("address_name"),
  isDefaultShipping: boolean("is_default_shipping").default(false).notNull(),
  isDefaultBilling: boolean("is_default_billing").default(false).notNull(),
  company: text(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  address1: text("address_1"),
  address2: text("address_2"),
  city: text(),
  countryCode: text("country_code"),
  province: text(),
  postalCode: text("postal_code"),
  phone: text(),
  metadata: jsonb(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("IDX_customer_address_customer_id").using("btree", table.customerId.asc().nullsLast()),
  index("IDX_customer_address_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  uniqueIndex("IDX_customer_address_unique_customer_billing").using("btree", table.customerId.asc().nullsLast()).where(sql`(is_default_billing = true)`),
  uniqueIndex("IDX_customer_address_unique_customer_shipping").using("btree", table.customerId.asc().nullsLast()).where(sql`(is_default_shipping = true)`),
]);

export const customerGroup = pgTable("customer_group", {
  id: text().primaryKey(),
  name: text().notNull(),
  metadata: jsonb(),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("IDX_customer_group_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  uniqueIndex("IDX_customer_group_name_unique").using("btree", table.name.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const customerGroupCustomer = pgTable("customer_group_customer", {
  id: text().primaryKey(),
  customerId: text("customer_id").notNull().references(() => customer.id, { onDelete: "cascade", onUpdate: "cascade" }),
  customerGroupId: text("customer_group_id").notNull().references(() => customerGroup.id, { onDelete: "cascade", onUpdate: "cascade" }),
  metadata: jsonb(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  createdBy: text("created_by"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("IDX_customer_group_customer_customer_group_id").using("btree", table.customerGroupId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_customer_group_customer_customer_id").using("btree", table.customerId.asc().nullsLast()),
  index("IDX_customer_group_customer_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const fulfillment = pgTable("fulfillment", {
  id: text().primaryKey(),
  locationId: text("location_id").notNull(),
  packedAt: timestamp("packed_at", { withTimezone: true }),
  shippedAt: timestamp("shipped_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  canceledAt: timestamp("canceled_at", { withTimezone: true }),
  data: jsonb(),
  providerId: text("provider_id").references(() => fulfillmentProvider.id, { onDelete: "set null", onUpdate: "cascade" }),
  shippingOptionId: text("shipping_option_id").references(() => shippingOption.id, { onDelete: "set null", onUpdate: "cascade" }),
  metadata: jsonb(),
  deliveryAddressId: text("delivery_address_id").references(() => fulfillmentAddress.id, { onDelete: "set null", onUpdate: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  markedShippedBy: text("marked_shipped_by"),
  createdBy: text("created_by"),
  requiresShipping: boolean("requires_shipping").default(true).notNull(),
}, (table) => [
  index("IDX_fulfillment_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NOT NULL)`),
  index("IDX_fulfillment_location_id").using("btree", table.locationId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_fulfillment_shipping_option_id").using("btree", table.shippingOptionId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const fulfillmentAddress = pgTable("fulfillment_address", {
  id: text().primaryKey(),
  company: text(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  address1: text("address_1"),
  address2: text("address_2"),
  city: text(),
  countryCode: text("country_code"),
  province: text(),
  postalCode: text("postal_code"),
  phone: text(),
  metadata: jsonb(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("IDX_fulfillment_address_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NOT NULL)`),
]);

export const fulfillmentItem = pgTable("fulfillment_item", {
  id: text().primaryKey(),
  title: text().notNull(),
  sku: text().notNull(),
  barcode: text().notNull(),
  quantity: numeric().notNull(),
  rawQuantity: jsonb("raw_quantity").notNull(),
  lineItemId: text("line_item_id"),
  inventoryItemId: text("inventory_item_id"),
  fulfillmentId: text("fulfillment_id").notNull().references(() => fulfillment.id, { onDelete: "cascade", onUpdate: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("IDX_fulfillment_item_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NOT NULL)`),
  index("IDX_fulfillment_item_fulfillment_id").using("btree", table.fulfillmentId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_fulfillment_item_inventory_item_id").using("btree", table.inventoryItemId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_fulfillment_item_line_item_id").using("btree", table.lineItemId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const fulfillmentLabel = pgTable("fulfillment_label", {
  id: text().primaryKey(),
  trackingNumber: text("tracking_number").notNull(),
  trackingUrl: text("tracking_url").notNull(),
  labelUrl: text("label_url").notNull(),
  fulfillmentId: text("fulfillment_id").notNull().references(() => fulfillment.id, { onDelete: "cascade", onUpdate: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("IDX_fulfillment_label_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NOT NULL)`),
  index("IDX_fulfillment_label_fulfillment_id").using("btree", table.fulfillmentId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const fulfillmentProvider = pgTable("fulfillment_provider", {
  id: text().primaryKey(),
  isEnabled: boolean("is_enabled").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("IDX_fulfillment_provider_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const fulfillmentSet = pgTable("fulfillment_set", {
  id: text().primaryKey(),
  name: text().notNull(),
  type: text().notNull(),
  metadata: jsonb(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("IDX_fulfillment_set_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NOT NULL)`),
  uniqueIndex("IDX_fulfillment_set_name_unique").using("btree", table.name.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const geoZone = pgTable("geo_zone", {
  id: text().primaryKey(),
  type: text().default("country").notNull(),
  countryCode: text("country_code").notNull(),
  provinceCode: text("province_code"),
  city: text(),
  serviceZoneId: text("service_zone_id").notNull().references(() => serviceZone.id, { onDelete: "cascade", onUpdate: "cascade" }),
  postalExpression: jsonb("postal_expression"),
  metadata: jsonb(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("IDX_geo_zone_city").using("btree", table.city.asc().nullsLast()).where(sql`((deleted_at IS NULL) AND (city IS NOT NULL))`),
  index("IDX_geo_zone_country_code").using("btree", table.countryCode.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_geo_zone_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NOT NULL)`),
  index("IDX_geo_zone_province_code").using("btree", table.provinceCode.asc().nullsLast()).where(sql`((deleted_at IS NULL) AND (province_code IS NOT NULL))`),
  index("IDX_geo_zone_service_zone_id").using("btree", table.serviceZoneId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  check("geo_zone_type_check", sql`(type = ANY (ARRAY['country'::text, 'province'::text, 'city'::text, 'zip'::text]))`),]);

export const image = pgTable("image", {
  id: text().primaryKey(),
  url: text().notNull(),
  metadata: jsonb(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  rank: integer().default(0).notNull(),
  productId: text("product_id").notNull().references(() => product.id, { onDelete: "cascade", onUpdate: "cascade" }),
}, (table) => [
  index("IDX_image_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_image_product_id").using("btree", table.productId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_product_image_rank").using("btree", table.rank.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_product_image_rank_product_id").using("btree", table.rank.asc().nullsLast(), table.productId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_product_image_url").using("btree", table.url.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_product_image_url_rank_product_id").using("btree", table.url.asc().nullsLast(), table.rank.asc().nullsLast(), table.productId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const inventoryItem = pgTable("inventory_item", {
  id: text().primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  sku: text(),
  originCountry: text("origin_country"),
  hsCode: text("hs_code"),
  midCode: text("mid_code"),
  material: text(),
  weight: integer(),
  length: integer(),
  height: integer(),
  width: integer(),
  requiresShipping: boolean("requires_shipping").default(true).notNull(),
  description: text(),
  title: text(),
  thumbnail: text(),
  metadata: jsonb(),
}, (table) => [
  index("IDX_inventory_item_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NOT NULL)`),
  uniqueIndex("IDX_inventory_item_sku").using("btree", table.sku.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const inventoryLevel = pgTable("inventory_level", {
  id: text().primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  inventoryItemId: text("inventory_item_id").notNull().references(() => inventoryItem.id, { onDelete: "cascade", onUpdate: "cascade" }),
  locationId: text("location_id").notNull(),
  stockedQuantity: numeric("stocked_quantity", { mode: 'number' }).default(0).notNull(),
  reservedQuantity: numeric("reserved_quantity", { mode: 'number' }).default(0).notNull(),
  incomingQuantity: numeric("incoming_quantity", { mode: 'number' }).default(0).notNull(),
  metadata: jsonb(),
  rawStockedQuantity: jsonb("raw_stocked_quantity"),
  rawReservedQuantity: jsonb("raw_reserved_quantity"),
  rawIncomingQuantity: jsonb("raw_incoming_quantity"),
}, (table) => [
  index("IDX_inventory_level_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NOT NULL)`),
  index("IDX_inventory_level_inventory_item_id").using("btree", table.inventoryItemId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_inventory_level_location_id").using("btree", table.locationId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  uniqueIndex("IDX_inventory_level_location_id_inventory_item_id").using("btree", table.inventoryItemId.asc().nullsLast(), table.locationId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const invite = pgTable("invite", {
  id: text().primaryKey(),
  email: text().notNull(),
  accepted: boolean().default(false).notNull(),
  token: text().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  metadata: jsonb(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("IDX_invite_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NOT NULL)`),
  uniqueIndex("IDX_invite_email_unique").using("btree", table.email.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_invite_token").using("btree", table.token.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const linkModuleMigrations = pgTable("link_module_migrations", {
  id: serial().primaryKey(),
  tableName: varchar("table_name", { length: 255 }).notNull(),
  linkDescriptor: jsonb("link_descriptor").default({}).notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  unique("link_module_migrations_table_name_key").on(table.tableName),]);

export const locationFulfillmentProvider = pgTable("location_fulfillment_provider", {
  stockLocationId: varchar("stock_location_id", { length: 255 }).notNull(),
  fulfillmentProviderId: varchar("fulfillment_provider_id", { length: 255 }).notNull(),
  id: varchar({ length: 255 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  primaryKey({ columns: [table.stockLocationId, table.fulfillmentProviderId], name: "location_fulfillment_provider_pkey" }),
  index("IDX_deleted_at_-1e5992737").using("btree", table.deletedAt.asc().nullsLast()),
  index("IDX_fulfillment_provider_id_-1e5992737").using("btree", table.fulfillmentProviderId.asc().nullsLast()),
  index("IDX_id_-1e5992737").using("btree", table.id.asc().nullsLast()),
  index("IDX_stock_location_id_-1e5992737").using("btree", table.stockLocationId.asc().nullsLast()),
]);

export const locationFulfillmentSet = pgTable("location_fulfillment_set", {
  stockLocationId: varchar("stock_location_id", { length: 255 }).notNull(),
  fulfillmentSetId: varchar("fulfillment_set_id", { length: 255 }).notNull(),
  id: varchar({ length: 255 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  primaryKey({ columns: [table.stockLocationId, table.fulfillmentSetId], name: "location_fulfillment_set_pkey" }),
  index("IDX_deleted_at_-e88adb96").using("btree", table.deletedAt.asc().nullsLast()),
  index("IDX_fulfillment_set_id_-e88adb96").using("btree", table.fulfillmentSetId.asc().nullsLast()),
  index("IDX_id_-e88adb96").using("btree", table.id.asc().nullsLast()),
  index("IDX_stock_location_id_-e88adb96").using("btree", table.stockLocationId.asc().nullsLast()),
]);

export const mikroOrmMigrations = pgTable("mikro_orm_migrations", {
  id: serial().primaryKey(),
  name: varchar({ length: 255 }),
  executedAt: timestamp("executed_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`),
});

export const notification = pgTable("notification", {
  id: text().primaryKey(),
  to: text().notNull(),
  channel: text().notNull(),
  template: text(),
  data: jsonb(),
  triggerType: text("trigger_type"),
  resourceId: text("resource_id"),
  resourceType: text("resource_type"),
  receiverId: text("receiver_id"),
  originalNotificationId: text("original_notification_id"),
  idempotencyKey: text("idempotency_key"),
  externalId: text("external_id"),
  providerId: text("provider_id").references(() => notificationProvider.id, { onDelete: "set null", onUpdate: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  status: text().default("pending").notNull(),
}, (table) => [
  index("IDX_notification_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  uniqueIndex("IDX_notification_idempotency_key_unique").using("btree", table.idempotencyKey.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_notification_provider_id").using("btree", table.providerId.asc().nullsLast()),
  index("IDX_notification_receiver_id").using("btree", table.receiverId.asc().nullsLast()),
  check("notification_status_check", sql`(status = ANY (ARRAY['pending'::text, 'success'::text, 'failure'::text]))`),]);

export const notificationProvider = pgTable("notification_provider", {
  id: text().primaryKey(),
  handle: text().notNull(),
  name: text().notNull(),
  isEnabled: boolean("is_enabled").default(true).notNull(),
  channels: text().array().default([]).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("IDX_notification_provider_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const order = pgTable("order", {
  id: text().primaryKey(),
  regionId: text("region_id"),
  displayId: serial("display_id"),
  customerId: text("customer_id"),
  version: integer().default(1).notNull(),
  salesChannelId: text("sales_channel_id"),
  status: orderStatusEnum().default("pending").notNull(),
  isDraftOrder: boolean("is_draft_order").default(false).notNull(),
  email: text(),
  currencyCode: text("currency_code").notNull(),
  shippingAddressId: text("shipping_address_id").references(() => orderAddress.id, { onDelete: "cascade", onUpdate: "cascade" }),
  billingAddressId: text("billing_address_id").references(() => orderAddress.id, { onDelete: "cascade", onUpdate: "cascade" }),
  noNotification: boolean("no_notification"),
  metadata: jsonb(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  canceledAt: timestamp("canceled_at", { withTimezone: true }),
}, (table) => [
  index("IDX_order_billing_address_id").using("btree", table.billingAddressId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_order_currency_code").using("btree", table.currencyCode.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_order_customer_id").using("btree", table.customerId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_order_deleted_at").using("btree", table.deletedAt.asc().nullsLast()),
  index("IDX_order_display_id").using("btree", table.displayId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_order_is_draft_order").using("btree", table.isDraftOrder.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_order_region_id").using("btree", table.regionId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_order_sales_channel_id").using("btree", table.salesChannelId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_order_shipping_address_id").using("btree", table.shippingAddressId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const orderAddress = pgTable("order_address", {
  id: text().primaryKey(),
  customerId: text("customer_id"),
  company: text(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  address1: text("address_1"),
  address2: text("address_2"),
  city: text(),
  countryCode: text("country_code"),
  province: text(),
  postalCode: text("postal_code"),
  phone: text(),
  metadata: jsonb(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("IDX_order_address_customer_id").using("btree", table.customerId.asc().nullsLast()),
  index("IDX_order_address_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const orderCart = pgTable("order_cart", {
  orderId: varchar("order_id", { length: 255 }).notNull(),
  cartId: varchar("cart_id", { length: 255 }).notNull(),
  id: varchar({ length: 255 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  primaryKey({ columns: [table.orderId, table.cartId], name: "order_cart_pkey" }),
  index("IDX_cart_id_-71069c16").using("btree", table.cartId.asc().nullsLast()),
  index("IDX_deleted_at_-71069c16").using("btree", table.deletedAt.asc().nullsLast()),
  index("IDX_id_-71069c16").using("btree", table.id.asc().nullsLast()),
  index("IDX_order_id_-71069c16").using("btree", table.orderId.asc().nullsLast()),
]);

export const orderChange = pgTable("order_change", {
  id: text().primaryKey(),
  orderId: text("order_id").notNull().references(() => order.id, { onDelete: "cascade", onUpdate: "cascade" }),
  version: integer().notNull(),
  description: text(),
  status: text().default("pending").notNull(),
  internalNote: text("internal_note"),
  createdBy: text("created_by"),
  requestedBy: text("requested_by"),
  requestedAt: timestamp("requested_at", { withTimezone: true }),
  confirmedBy: text("confirmed_by"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  declinedBy: text("declined_by"),
  declinedReason: text("declined_reason"),
  metadata: jsonb(),
  declinedAt: timestamp("declined_at", { withTimezone: true }),
  canceledBy: text("canceled_by"),
  canceledAt: timestamp("canceled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  changeType: text("change_type"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  returnId: text("return_id"),
  claimId: text("claim_id"),
  exchangeId: text("exchange_id"),
}, (table) => [
  index("IDX_order_change_change_type").using("btree", table.changeType.asc().nullsLast()),
  index("IDX_order_change_claim_id").using("btree", table.claimId.asc().nullsLast()).where(sql`((claim_id IS NOT NULL) AND (deleted_at IS NULL))`),
  index("IDX_order_change_deleted_at").using("btree", table.deletedAt.asc().nullsLast()),
  index("IDX_order_change_exchange_id").using("btree", table.exchangeId.asc().nullsLast()).where(sql`((exchange_id IS NOT NULL) AND (deleted_at IS NULL))`),
  index("IDX_order_change_order_id").using("btree", table.orderId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_order_change_order_id_version").using("btree", table.orderId.asc().nullsLast(), table.version.asc().nullsLast()),
  index("IDX_order_change_return_id").using("btree", table.returnId.asc().nullsLast()).where(sql`((return_id IS NOT NULL) AND (deleted_at IS NULL))`),
  index("IDX_order_change_status").using("btree", table.status.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_order_change_version").using("btree", table.orderId.asc().nullsLast(), table.version.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  check("order_change_status_check", sql`(status = ANY (ARRAY['confirmed'::text, 'declined'::text, 'requested'::text, 'pending'::text, 'canceled'::text]))`),]);

export const orderChangeAction = pgTable("order_change_action", {
  id: text().primaryKey(),
  orderId: text("order_id"),
  version: integer(),
  ordering: bigserial({ mode: 'number' }).notNull(),
  orderChangeId: text("order_change_id").references(() => orderChange.id, { onDelete: "cascade", onUpdate: "cascade" }),
  reference: text(),
  referenceId: text("reference_id"),
  action: text().notNull(),
  details: jsonb(),
  amount: numeric(),
  rawAmount: jsonb("raw_amount"),
  internalNote: text("internal_note"),
  applied: boolean().default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  returnId: text("return_id"),
  claimId: text("claim_id"),
  exchangeId: text("exchange_id"),
}, (table) => [
  index("IDX_order_change_action_claim_id").using("btree", table.claimId.asc().nullsLast()).where(sql`((claim_id IS NOT NULL) AND (deleted_at IS NULL))`),
  index("IDX_order_change_action_deleted_at").using("btree", table.deletedAt.asc().nullsLast()),
  index("IDX_order_change_action_exchange_id").using("btree", table.exchangeId.asc().nullsLast()).where(sql`((exchange_id IS NOT NULL) AND (deleted_at IS NULL))`),
  index("IDX_order_change_action_order_change_id").using("btree", table.orderChangeId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_order_change_action_order_id").using("btree", table.orderId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_order_change_action_ordering").using("btree", table.ordering.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_order_change_action_return_id").using("btree", table.returnId.asc().nullsLast()).where(sql`((return_id IS NOT NULL) AND (deleted_at IS NULL))`),
]);

export const orderClaim = pgTable("order_claim", {
  id: text().primaryKey(),
  orderId: text("order_id").notNull(),
  returnId: text("return_id"),
  orderVersion: integer("order_version").notNull(),
  displayId: serial("display_id").notNull(),
  type: orderClaimTypeEnum().notNull(),
  noNotification: boolean("no_notification"),
  refundAmount: numeric("refund_amount"),
  rawRefundAmount: jsonb("raw_refund_amount"),
  metadata: jsonb(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  canceledAt: timestamp("canceled_at", { withTimezone: true }),
  createdBy: text("created_by"),
}, (table) => [
  index("IDX_order_claim_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_order_claim_display_id").using("btree", table.displayId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_order_claim_order_id").using("btree", table.orderId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_order_claim_return_id").using("btree", table.returnId.asc().nullsLast()).where(sql`((return_id IS NOT NULL) AND (deleted_at IS NULL))`),
]);

export const orderClaimItem = pgTable("order_claim_item", {
  id: text().primaryKey(),
  claimId: text("claim_id").notNull(),
  itemId: text("item_id").notNull(),
  isAdditionalItem: boolean("is_additional_item").default(false).notNull(),
  reason: claimReasonEnum(),
  quantity: numeric().notNull(),
  rawQuantity: jsonb("raw_quantity").notNull(),
  note: text(),
  metadata: jsonb(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("IDX_order_claim_item_claim_id").using("btree", table.claimId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_order_claim_item_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_order_claim_item_item_id").using("btree", table.itemId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const orderClaimItemImage = pgTable("order_claim_item_image", {
  id: text().primaryKey(),
  claimItemId: text("claim_item_id").notNull(),
  url: text().notNull(),
  metadata: jsonb(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("IDX_order_claim_item_image_claim_item_id").using("btree", table.claimItemId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_order_claim_item_image_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NOT NULL)`),
]);

export const orderCreditLine = pgTable("order_credit_line", {
  id: text().primaryKey(),
  orderId: text("order_id").notNull().references(() => order.id, { onDelete: "cascade", onUpdate: "cascade" }),
  reference: text(),
  referenceId: text("reference_id"),
  amount: numeric().notNull(),
  rawAmount: jsonb("raw_amount").notNull(),
  metadata: jsonb(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  version: integer().default(1).notNull(),
}, (table) => [
  index("IDX_order_credit_line_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NOT NULL)`),
  index("IDX_order_credit_line_order_id").using("btree", table.orderId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_order_credit_line_order_id_version").using("btree", table.orderId.asc().nullsLast(), table.version.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const orderExchange = pgTable("order_exchange", {
  id: text().primaryKey(),
  orderId: text("order_id").notNull(),
  returnId: text("return_id"),
  orderVersion: integer("order_version").notNull(),
  displayId: serial("display_id").notNull(),
  noNotification: boolean("no_notification"),
  allowBackorder: boolean("allow_backorder").default(false).notNull(),
  differenceDue: numeric("difference_due"),
  rawDifferenceDue: jsonb("raw_difference_due"),
  metadata: jsonb(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  canceledAt: timestamp("canceled_at", { withTimezone: true }),
  createdBy: text("created_by"),
}, (table) => [
  index("IDX_order_exchange_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_order_exchange_display_id").using("btree", table.displayId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_order_exchange_order_id").using("btree", table.orderId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_order_exchange_return_id").using("btree", table.returnId.asc().nullsLast()).where(sql`((return_id IS NOT NULL) AND (deleted_at IS NULL))`),
]);

export const orderExchangeItem = pgTable("order_exchange_item", {
  id: text().primaryKey(),
  exchangeId: text("exchange_id").notNull(),
  itemId: text("item_id").notNull(),
  quantity: numeric().notNull(),
  rawQuantity: jsonb("raw_quantity").notNull(),
  note: text(),
  metadata: jsonb(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("IDX_order_exchange_item_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_order_exchange_item_exchange_id").using("btree", table.exchangeId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_order_exchange_item_item_id").using("btree", table.itemId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const orderFulfillment = pgTable("order_fulfillment", {
  orderId: varchar("order_id", { length: 255 }).notNull(),
  fulfillmentId: varchar("fulfillment_id", { length: 255 }).notNull(),
  id: varchar({ length: 255 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  primaryKey({ columns: [table.orderId, table.fulfillmentId], name: "order_fulfillment_pkey" }),
  index("IDX_deleted_at_-e8d2543e").using("btree", table.deletedAt.asc().nullsLast()),
  index("IDX_fulfillment_id_-e8d2543e").using("btree", table.fulfillmentId.asc().nullsLast()),
  index("IDX_id_-e8d2543e").using("btree", table.id.asc().nullsLast()),
  index("IDX_order_id_-e8d2543e").using("btree", table.orderId.asc().nullsLast()),
]);

export const orderItem = pgTable("order_item", {
  id: text().primaryKey(),
  orderId: text("order_id").notNull().references(() => order.id, { onDelete: "cascade", onUpdate: "cascade" }),
  version: integer().notNull(),
  itemId: text("item_id").notNull().references((): AnyPgColumn => orderLineItem.id, { onDelete: "cascade", onUpdate: "cascade" }),
  quantity: numeric().notNull(),
  rawQuantity: jsonb("raw_quantity").notNull(),
  fulfilledQuantity: numeric("fulfilled_quantity").notNull(),
  rawFulfilledQuantity: jsonb("raw_fulfilled_quantity").notNull(),
  shippedQuantity: numeric("shipped_quantity").notNull(),
  rawShippedQuantity: jsonb("raw_shipped_quantity").notNull(),
  returnRequestedQuantity: numeric("return_requested_quantity").notNull(),
  rawReturnRequestedQuantity: jsonb("raw_return_requested_quantity").notNull(),
  returnReceivedQuantity: numeric("return_received_quantity").notNull(),
  rawReturnReceivedQuantity: jsonb("raw_return_received_quantity").notNull(),
  returnDismissedQuantity: numeric("return_dismissed_quantity").notNull(),
  rawReturnDismissedQuantity: jsonb("raw_return_dismissed_quantity").notNull(),
  writtenOffQuantity: numeric("written_off_quantity").notNull(),
  rawWrittenOffQuantity: jsonb("raw_written_off_quantity").notNull(),
  metadata: jsonb(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deliveredQuantity: numeric("delivered_quantity", { mode: 'number' }).default(0).notNull(),
  rawDeliveredQuantity: jsonb("raw_delivered_quantity").notNull(),
  unitPrice: numeric("unit_price"),
  rawUnitPrice: jsonb("raw_unit_price"),
  compareAtUnitPrice: numeric("compare_at_unit_price"),
  rawCompareAtUnitPrice: jsonb("raw_compare_at_unit_price"),
}, (table) => [
  index("IDX_order_item_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NOT NULL)`),
  index("IDX_order_item_item_id").using("btree", table.itemId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_order_item_order_id").using("btree", table.orderId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_order_item_order_id_version").using("btree", table.orderId.asc().nullsLast(), table.version.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const orderLineItem = pgTable("order_line_item", {
  id: text().primaryKey(),
  totalsId: text("totals_id").references((): AnyPgColumn => orderItem.id, { onDelete: "cascade", onUpdate: "cascade" }),
  title: text().notNull(),
  subtitle: text(),
  thumbnail: text(),
  variantId: text("variant_id"),
  productId: text("product_id"),
  productTitle: text("product_title"),
  productDescription: text("product_description"),
  productSubtitle: text("product_subtitle"),
  productType: text("product_type"),
  productCollection: text("product_collection"),
  productHandle: text("product_handle"),
  variantSku: text("variant_sku"),
  variantBarcode: text("variant_barcode"),
  variantTitle: text("variant_title"),
  variantOptionValues: jsonb("variant_option_values"),
  requiresShipping: boolean("requires_shipping").default(true).notNull(),
  isDiscountable: boolean("is_discountable").default(true).notNull(),
  isTaxInclusive: boolean("is_tax_inclusive").default(false).notNull(),
  compareAtUnitPrice: numeric("compare_at_unit_price"),
  rawCompareAtUnitPrice: jsonb("raw_compare_at_unit_price"),
  unitPrice: numeric("unit_price").notNull(),
  rawUnitPrice: jsonb("raw_unit_price").notNull(),
  metadata: jsonb(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  isCustomPrice: boolean("is_custom_price").default(false).notNull(),
  productTypeId: text("product_type_id"),
  isGiftcard: boolean("is_giftcard").default(false).notNull(),
}, (table) => [
  index("IDX_line_item_product_type_id").using("btree", table.productTypeId.asc().nullsLast()).where(sql`((deleted_at IS NULL) AND (product_type_id IS NOT NULL))`),
  index("IDX_order_line_item_product_id").using("btree", table.productId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_order_line_item_variant_id").using("btree", table.variantId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const orderLineItemAdjustment = pgTable("order_line_item_adjustment", {
  id: text().primaryKey(),
  description: text(),
  promotionId: text("promotion_id"),
  code: text(),
  amount: numeric().notNull(),
  rawAmount: jsonb("raw_amount").notNull(),
  providerId: text("provider_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  itemId: text("item_id").notNull().references(() => orderLineItem.id, { onDelete: "cascade", onUpdate: "cascade" }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  isTaxInclusive: boolean("is_tax_inclusive").default(false).notNull(),
}, (table) => [
  index("IDX_order_line_item_adjustment_item_id").using("btree", table.itemId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const orderLineItemTaxLine = pgTable("order_line_item_tax_line", {
  id: text().primaryKey(),
  description: text(),
  taxRateId: text("tax_rate_id"),
  code: text().notNull(),
  rate: numeric().notNull(),
  rawRate: jsonb("raw_rate").notNull(),
  providerId: text("provider_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  itemId: text("item_id").notNull().references(() => orderLineItem.id, { onDelete: "cascade", onUpdate: "cascade" }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("IDX_order_line_item_tax_line_item_id").using("btree", table.itemId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const orderPaymentCollection = pgTable("order_payment_collection", {
  orderId: varchar("order_id", { length: 255 }).notNull(),
  paymentCollectionId: varchar("payment_collection_id", { length: 255 }).notNull(),
  id: varchar({ length: 255 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  primaryKey({ columns: [table.orderId, table.paymentCollectionId], name: "order_payment_collection_pkey" }),
  index("IDX_deleted_at_f42b9949").using("btree", table.deletedAt.asc().nullsLast()),
  index("IDX_id_f42b9949").using("btree", table.id.asc().nullsLast()),
  index("IDX_order_id_f42b9949").using("btree", table.orderId.asc().nullsLast()),
  index("IDX_payment_collection_id_f42b9949").using("btree", table.paymentCollectionId.asc().nullsLast()),
]);

export const orderPromotion = pgTable("order_promotion", {
  orderId: varchar("order_id", { length: 255 }).notNull(),
  promotionId: varchar("promotion_id", { length: 255 }).notNull(),
  id: varchar({ length: 255 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  primaryKey({ columns: [table.orderId, table.promotionId], name: "order_promotion_pkey" }),
  index("IDX_deleted_at_-71518339").using("btree", table.deletedAt.asc().nullsLast()),
  index("IDX_id_-71518339").using("btree", table.id.asc().nullsLast()),
  index("IDX_order_id_-71518339").using("btree", table.orderId.asc().nullsLast()),
  index("IDX_promotion_id_-71518339").using("btree", table.promotionId.asc().nullsLast()),
]);

export const orderShipping = pgTable("order_shipping", {
  id: text().primaryKey(),
  orderId: text("order_id").notNull().references(() => order.id, { onDelete: "cascade", onUpdate: "cascade" }),
  version: integer().notNull(),
  shippingMethodId: text("shipping_method_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  returnId: text("return_id"),
  claimId: text("claim_id"),
  exchangeId: text("exchange_id"),
}, (table) => [
  index("IDX_order_shipping_claim_id").using("btree", table.claimId.asc().nullsLast()).where(sql`((claim_id IS NOT NULL) AND (deleted_at IS NULL))`),
  index("IDX_order_shipping_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NOT NULL)`),
  index("IDX_order_shipping_exchange_id").using("btree", table.exchangeId.asc().nullsLast()).where(sql`((exchange_id IS NOT NULL) AND (deleted_at IS NULL))`),
  index("IDX_order_shipping_item_id").using("btree", table.shippingMethodId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_order_shipping_order_id").using("btree", table.orderId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_order_shipping_order_id_version").using("btree", table.orderId.asc().nullsLast(), table.version.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_order_shipping_return_id").using("btree", table.returnId.asc().nullsLast()).where(sql`((return_id IS NOT NULL) AND (deleted_at IS NULL))`),
  index("IDX_order_shipping_shipping_method_id").using("btree", table.shippingMethodId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const orderShippingMethod = pgTable("order_shipping_method", {
  id: text().primaryKey(),
  name: text().notNull(),
  description: jsonb(),
  amount: numeric().notNull(),
  rawAmount: jsonb("raw_amount").notNull(),
  isTaxInclusive: boolean("is_tax_inclusive").default(false).notNull(),
  shippingOptionId: text("shipping_option_id"),
  data: jsonb(),
  metadata: jsonb(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  isCustomAmount: boolean("is_custom_amount").default(false).notNull(),
}, (table) => [
  index("IDX_order_shipping_method_shipping_option_id").using("btree", table.shippingOptionId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const orderShippingMethodAdjustment = pgTable("order_shipping_method_adjustment", {
  id: text().primaryKey(),
  description: text(),
  promotionId: text("promotion_id"),
  code: text(),
  amount: numeric().notNull(),
  rawAmount: jsonb("raw_amount").notNull(),
  providerId: text("provider_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  shippingMethodId: text("shipping_method_id").notNull().references(() => orderShippingMethod.id, { onDelete: "cascade", onUpdate: "cascade" }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("IDX_order_shipping_method_adjustment_shipping_method_id").using("btree", table.shippingMethodId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const orderShippingMethodTaxLine = pgTable("order_shipping_method_tax_line", {
  id: text().primaryKey(),
  description: text(),
  taxRateId: text("tax_rate_id"),
  code: text().notNull(),
  rate: numeric().notNull(),
  rawRate: jsonb("raw_rate").notNull(),
  providerId: text("provider_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  shippingMethodId: text("shipping_method_id").notNull().references(() => orderShippingMethod.id, { onDelete: "cascade", onUpdate: "cascade" }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("IDX_order_shipping_method_tax_line_shipping_method_id").using("btree", table.shippingMethodId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const orderSummary = pgTable("order_summary", {
  id: text().primaryKey(),
  orderId: text("order_id").notNull().references(() => order.id, { onDelete: "cascade", onUpdate: "cascade" }),
  version: integer().default(1).notNull(),
  totals: jsonb(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("IDX_order_summary_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NOT NULL)`),
  index("IDX_order_summary_order_id_version").using("btree", table.orderId.asc().nullsLast(), table.version.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const orderTransaction = pgTable("order_transaction", {
  id: text().primaryKey(),
  orderId: text("order_id").notNull().references(() => order.id, { onDelete: "cascade", onUpdate: "cascade" }),
  version: integer().default(1).notNull(),
  amount: numeric().notNull(),
  rawAmount: jsonb("raw_amount").notNull(),
  currencyCode: text("currency_code").notNull(),
  reference: text(),
  referenceId: text("reference_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  returnId: text("return_id"),
  claimId: text("claim_id"),
  exchangeId: text("exchange_id"),
}, (table) => [
  index("IDX_order_transaction_claim_id").using("btree", table.claimId.asc().nullsLast()).where(sql`((claim_id IS NOT NULL) AND (deleted_at IS NULL))`),
  index("IDX_order_transaction_currency_code").using("btree", table.currencyCode.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_order_transaction_exchange_id").using("btree", table.exchangeId.asc().nullsLast()).where(sql`((exchange_id IS NOT NULL) AND (deleted_at IS NULL))`),
  index("IDX_order_transaction_order_id").using("btree", table.orderId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_order_transaction_order_id_version").using("btree", table.orderId.asc().nullsLast(), table.version.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_order_transaction_reference_id").using("btree", table.referenceId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_order_transaction_return_id").using("btree", table.returnId.asc().nullsLast()).where(sql`((return_id IS NOT NULL) AND (deleted_at IS NULL))`),
]);

export const payment = pgTable("payment", {
  id: text().primaryKey(),
  amount: numeric().notNull(),
  rawAmount: jsonb("raw_amount").notNull(),
  currencyCode: text("currency_code").notNull(),
  providerId: text("provider_id").notNull(),
  data: jsonb(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  capturedAt: timestamp("captured_at", { withTimezone: true }),
  canceledAt: timestamp("canceled_at", { withTimezone: true }),
  paymentCollectionId: text("payment_collection_id").notNull().references(() => paymentCollection.id, { onDelete: "cascade", onUpdate: "cascade" }),
  paymentSessionId: text("payment_session_id").notNull(),
  metadata: jsonb(),
}, (table) => [
  index("IDX_payment_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NOT NULL)`),
  index("IDX_payment_payment_collection_id").using("btree", table.paymentCollectionId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_payment_payment_session_id").using("btree", table.paymentSessionId.asc().nullsLast()),
  uniqueIndex("IDX_payment_payment_session_id_unique").using("btree", table.paymentSessionId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_payment_provider_id").using("btree", table.providerId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const paymentCollection = pgTable("payment_collection", {
  id: text().primaryKey(),
  currencyCode: text("currency_code").notNull(),
  amount: numeric().notNull(),
  rawAmount: jsonb("raw_amount").notNull(),
  authorizedAmount: numeric("authorized_amount"),
  rawAuthorizedAmount: jsonb("raw_authorized_amount"),
  capturedAmount: numeric("captured_amount"),
  rawCapturedAmount: jsonb("raw_captured_amount"),
  refundedAmount: numeric("refunded_amount"),
  rawRefundedAmount: jsonb("raw_refunded_amount"),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  status: text().default("not_paid").notNull(),
  metadata: jsonb(),
}, (table) => [
  index("IDX_payment_collection_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NOT NULL)`),
  check("payment_collection_status_check", sql`(status = ANY (ARRAY['not_paid'::text, 'awaiting'::text, 'authorized'::text, 'partially_authorized'::text, 'canceled'::text, 'failed'::text, 'partially_captured'::text, 'completed'::text]))`),]);

export const paymentCollectionPaymentProviders = pgTable("payment_collection_payment_providers", {
  paymentCollectionId: text("payment_collection_id").notNull().references(() => paymentCollection.id, { onDelete: "cascade", onUpdate: "cascade" }),
  paymentProviderId: text("payment_provider_id").notNull().references(() => paymentProvider.id, { onDelete: "cascade", onUpdate: "cascade" }),
}, (table) => [
  primaryKey({ columns: [table.paymentCollectionId, table.paymentProviderId], name: "payment_collection_payment_providers_pkey" }),
]);

export const paymentProvider = pgTable("payment_provider", {
  id: text().primaryKey(),
  isEnabled: boolean("is_enabled").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("IDX_payment_provider_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const paymentSession = pgTable("payment_session", {
  id: text().primaryKey(),
  currencyCode: text("currency_code").notNull(),
  amount: numeric().notNull(),
  rawAmount: jsonb("raw_amount").notNull(),
  providerId: text("provider_id").notNull(),
  data: jsonb().default({}).notNull(),
  context: jsonb(),
  status: text().default("pending").notNull(),
  authorizedAt: timestamp("authorized_at", { withTimezone: true }),
  paymentCollectionId: text("payment_collection_id").notNull().references(() => paymentCollection.id, { onDelete: "cascade", onUpdate: "cascade" }),
  metadata: jsonb(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("IDX_payment_session_deleted_at").using("btree", table.deletedAt.asc().nullsLast()),
  index("IDX_payment_session_payment_collection_id").using("btree", table.paymentCollectionId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  check("payment_session_status_check", sql`(status = ANY (ARRAY['authorized'::text, 'captured'::text, 'pending'::text, 'requires_more'::text, 'error'::text, 'canceled'::text]))`),]);

export const price = pgTable("price", {
  id: text().primaryKey(),
  title: text(),
  priceSetId: text("price_set_id").notNull().references(() => priceSet.id, { onDelete: "cascade", onUpdate: "cascade" }),
  currencyCode: text("currency_code").notNull(),
  rawAmount: jsonb("raw_amount").notNull(),
  rulesCount: integer("rules_count").default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  priceListId: text("price_list_id").references(() => priceList.id, { onDelete: "cascade", onUpdate: "cascade" }),
  amount: numeric().notNull(),
  minQuantity: integer("min_quantity"),
  maxQuantity: integer("max_quantity"),
}, (table) => [
  index("IDX_price_currency_code").using("btree", table.currencyCode.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_price_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NOT NULL)`),
  index("IDX_price_price_list_id").using("btree", table.priceListId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_price_price_set_id").using("btree", table.priceSetId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const priceList = pgTable("price_list", {
  id: text().primaryKey(),
  status: text().default("draft").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  rulesCount: integer("rules_count").default(0),
  title: text().notNull(),
  description: text().notNull(),
  type: text().default("sale").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("IDX_price_list_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NOT NULL)`),
  index("IDX_price_list_id_status_starts_at_ends_at").using("btree", table.id.asc().nullsLast(), table.status.asc().nullsLast(), table.startsAt.asc().nullsLast(), table.endsAt.asc().nullsLast()).where(sql`((deleted_at IS NULL) AND (status = 'active'::text))`),
  check("price_list_status_check", sql`(status = ANY (ARRAY['active'::text, 'draft'::text]))`), check("price_list_type_check", sql`(type = ANY (ARRAY['sale'::text, 'override'::text]))`),]);

export const priceListRule = pgTable("price_list_rule", {
  id: text().primaryKey(),
  priceListId: text("price_list_id").notNull().references(() => priceList.id, { onDelete: "cascade", onUpdate: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  value: jsonb(),
  attribute: text().default("").notNull(),
}, (table) => [
  index("IDX_price_list_rule_attribute").using("btree", table.attribute.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_price_list_rule_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NOT NULL)`),
  index("IDX_price_list_rule_price_list_id").using("btree", table.priceListId.asc().nullsLast()).where(sql`(deleted_at IS NOT NULL)`),
  index("IDX_price_list_rule_value").using("gin", table.value.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const pricePreference = pgTable("price_preference", {
  id: text().primaryKey(),
  attribute: text().notNull(),
  value: text(),
  isTaxInclusive: boolean("is_tax_inclusive").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("IDX_price_preference_attribute_value").using("btree", table.attribute.asc().nullsLast(), table.value.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_price_preference_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NOT NULL)`),
]);

export const priceRule = pgTable("price_rule", {
  id: text().primaryKey(),
  value: text().notNull(),
  priority: integer().default(0).notNull(),
  priceId: text("price_id").notNull().references(() => price.id, { onDelete: "cascade", onUpdate: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  attribute: text().default("").notNull(),
  operator: text().default("eq").notNull(),
}, (table) => [
  index("IDX_price_rule_attribute").using("btree", table.attribute.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_price_rule_attribute_value").using("btree", table.attribute.asc().nullsLast(), table.value.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_price_rule_attribute_value_price_id").using("btree", table.attribute.asc().nullsLast(), table.value.asc().nullsLast(), table.priceId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_price_rule_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NOT NULL)`),
  index("IDX_price_rule_operator").using("btree", table.operator.asc().nullsLast()),
  index("IDX_price_rule_operator_value").using("btree", table.operator.asc().nullsLast(), table.value.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_price_rule_price_id").using("btree", table.priceId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  uniqueIndex("IDX_price_rule_price_id_attribute_operator_unique").using("btree", table.priceId.asc().nullsLast(), table.attribute.asc().nullsLast(), table.operator.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  check("price_rule_operator_check", sql`(operator = ANY (ARRAY['gte'::text, 'lte'::text, 'gt'::text, 'lt'::text, 'eq'::text]))`),]);

export const priceSet = pgTable("price_set", {
  id: text().primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("IDX_price_set_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NOT NULL)`),
]);

export const product = pgTable("product", {
  id: text().primaryKey(),
  title: text().notNull(),
  handle: text().notNull(),
  subtitle: text(),
  description: text(),
  isGiftcard: boolean("is_giftcard").default(false).notNull(),
  status: text().default("draft").notNull(),
  thumbnail: text(),
  weight: text(),
  length: text(),
  height: text(),
  width: text(),
  originCountry: text("origin_country"),
  hsCode: text("hs_code"),
  midCode: text("mid_code"),
  material: text(),
  collectionId: text("collection_id").references(() => productCollection.id, { onDelete: "set null", onUpdate: "cascade" }),
  typeId: text("type_id").references(() => productType.id, { onDelete: "set null", onUpdate: "cascade" }),
  discountable: boolean().default(true).notNull(),
  externalId: text("external_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  metadata: jsonb(),
}, (table) => [
  index("IDX_product_collection_id").using("btree", table.collectionId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_product_deleted_at").using("btree", table.deletedAt.asc().nullsLast()),
  uniqueIndex("IDX_product_handle_unique").using("btree", table.handle.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_product_status").using("btree", table.status.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_product_type_id").using("btree", table.typeId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  check("product_status_check", sql`(status = ANY (ARRAY['draft'::text, 'proposed'::text, 'published'::text, 'rejected'::text]))`),]);

export const productCategory = pgTable("product_category", {
  id: text().primaryKey(),
  name: text().notNull(),
  description: text().default("").notNull(),
  handle: text().notNull(),
  mpath: text().notNull(),
  isActive: boolean("is_active").default(false).notNull(),
  isInternal: boolean("is_internal").default(false).notNull(),
  rank: integer().default(0).notNull(),
  parentCategoryId: text("parent_category_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  metadata: jsonb(),
}, (table) => [
  foreignKey({
    columns: [table.parentCategoryId],
    foreignColumns: [table.id],
    name: "product_category_parent_category_id_foreign"
  }).onUpdate("cascade").onDelete("cascade"),
  uniqueIndex("IDX_category_handle_unique").using("btree", table.handle.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_product_category_parent_category_id").using("btree", table.parentCategoryId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_product_category_path").using("btree", table.mpath.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const productCategoryProduct = pgTable("product_category_product", {
  productId: text("product_id").notNull().references(() => product.id, { onDelete: "cascade", onUpdate: "cascade" }),
  productCategoryId: text("product_category_id").notNull().references(() => productCategory.id, { onDelete: "cascade", onUpdate: "cascade" }),
}, (table) => [
  primaryKey({ columns: [table.productId, table.productCategoryId], name: "product_category_product_pkey" }),
]);

export const productCollection = pgTable("product_collection", {
  id: text().primaryKey(),
  title: text().notNull(),
  handle: text().notNull(),
  metadata: jsonb(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("IDX_collection_handle_unique").using("btree", table.handle.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_product_collection_deleted_at").using("btree", table.deletedAt.asc().nullsLast()),
]);

export const productOption = pgTable("product_option", {
  id: text().primaryKey(),
  title: text().notNull(),
  productId: text("product_id").notNull().references(() => product.id, { onDelete: "cascade", onUpdate: "cascade" }),
  metadata: jsonb(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("IDX_option_product_id_title_unique").using("btree", table.productId.asc().nullsLast(), table.title.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_product_option_deleted_at").using("btree", table.deletedAt.asc().nullsLast()),
  index("IDX_product_option_product_id").using("btree", table.productId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const productOptionValue = pgTable("product_option_value", {
  id: text().primaryKey(),
  value: text().notNull(),
  optionId: text("option_id").references(() => productOption.id, { onDelete: "cascade", onUpdate: "cascade" }),
  metadata: jsonb(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("IDX_option_value_option_id_unique").using("btree", table.optionId.asc().nullsLast(), table.value.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_product_option_value_deleted_at").using("btree", table.deletedAt.asc().nullsLast()),
  index("IDX_product_option_value_option_id").using("btree", table.optionId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const productSalesChannel = pgTable("product_sales_channel", {
  productId: varchar("product_id", { length: 255 }).notNull(),
  salesChannelId: varchar("sales_channel_id", { length: 255 }).notNull(),
  id: varchar({ length: 255 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  primaryKey({ columns: [table.productId, table.salesChannelId], name: "product_sales_channel_pkey" }),
  index("IDX_deleted_at_20b454295").using("btree", table.deletedAt.asc().nullsLast()),
  index("IDX_id_20b454295").using("btree", table.id.asc().nullsLast()),
  index("IDX_product_id_20b454295").using("btree", table.productId.asc().nullsLast()),
  index("IDX_sales_channel_id_20b454295").using("btree", table.salesChannelId.asc().nullsLast()),
]);

export const productShippingProfile = pgTable("product_shipping_profile", {
  productId: varchar("product_id", { length: 255 }).notNull(),
  shippingProfileId: varchar("shipping_profile_id", { length: 255 }).notNull(),
  id: varchar({ length: 255 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  primaryKey({ columns: [table.productId, table.shippingProfileId], name: "product_shipping_profile_pkey" }),
  index("IDX_deleted_at_17a262437").using("btree", table.deletedAt.asc().nullsLast()),
  index("IDX_id_17a262437").using("btree", table.id.asc().nullsLast()),
  index("IDX_product_id_17a262437").using("btree", table.productId.asc().nullsLast()),
  index("IDX_shipping_profile_id_17a262437").using("btree", table.shippingProfileId.asc().nullsLast()),
]);

export const productTag = pgTable("product_tag", {
  id: text().primaryKey(),
  value: text().notNull(),
  metadata: jsonb(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("IDX_product_tag_deleted_at").using("btree", table.deletedAt.asc().nullsLast()),
  uniqueIndex("IDX_tag_value_unique").using("btree", table.value.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const productTags = pgTable("product_tags", {
  productId: text("product_id").notNull().references(() => product.id, { onDelete: "cascade", onUpdate: "cascade" }),
  productTagId: text("product_tag_id").notNull().references(() => productTag.id, { onDelete: "cascade", onUpdate: "cascade" }),
}, (table) => [
  primaryKey({ columns: [table.productId, table.productTagId], name: "product_tags_pkey" }),
]);

export const productType = pgTable("product_type", {
  id: text().primaryKey(),
  value: text().notNull(),
  metadata: json(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("IDX_product_type_deleted_at").using("btree", table.deletedAt.asc().nullsLast()),
  uniqueIndex("IDX_type_value_unique").using("btree", table.value.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const productVariant = pgTable("product_variant", {
  id: text().primaryKey(),
  title: text().notNull(),
  sku: text(),
  barcode: text(),
  ean: text(),
  upc: text(),
  allowBackorder: boolean("allow_backorder").default(false).notNull(),
  manageInventory: boolean("manage_inventory").default(true).notNull(),
  hsCode: text("hs_code"),
  originCountry: text("origin_country"),
  midCode: text("mid_code"),
  material: text(),
  weight: integer(),
  length: integer(),
  height: integer(),
  width: integer(),
  metadata: jsonb(),
  variantRank: integer("variant_rank").default(0),
  productId: text("product_id").references(() => product.id, { onDelete: "cascade", onUpdate: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  thumbnail: text(),
}, (table) => [
  uniqueIndex("IDX_product_variant_barcode_unique").using("btree", table.barcode.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_product_variant_deleted_at").using("btree", table.deletedAt.asc().nullsLast()),
  uniqueIndex("IDX_product_variant_ean_unique").using("btree", table.ean.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_product_variant_id_product_id").using("btree", table.id.asc().nullsLast(), table.productId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_product_variant_product_id").using("btree", table.productId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  uniqueIndex("IDX_product_variant_sku_unique").using("btree", table.sku.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  uniqueIndex("IDX_product_variant_upc_unique").using("btree", table.upc.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const productVariantInventoryItem = pgTable("product_variant_inventory_item", {
  variantId: varchar("variant_id", { length: 255 }).notNull(),
  inventoryItemId: varchar("inventory_item_id", { length: 255 }).notNull(),
  id: varchar({ length: 255 }).notNull(),
  requiredQuantity: integer("required_quantity").default(1).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  primaryKey({ columns: [table.variantId, table.inventoryItemId], name: "product_variant_inventory_item_pkey" }),
  index("IDX_deleted_at_17b4c4e35").using("btree", table.deletedAt.asc().nullsLast()),
  index("IDX_id_17b4c4e35").using("btree", table.id.asc().nullsLast()),
  index("IDX_inventory_item_id_17b4c4e35").using("btree", table.inventoryItemId.asc().nullsLast()),
  index("IDX_variant_id_17b4c4e35").using("btree", table.variantId.asc().nullsLast()),
]);

export const productVariantOption = pgTable("product_variant_option", {
  variantId: text("variant_id").notNull().references(() => productVariant.id, { onDelete: "cascade", onUpdate: "cascade" }),
  optionValueId: text("option_value_id").notNull().references(() => productOptionValue.id, { onDelete: "cascade", onUpdate: "cascade" }),
}, (table) => [
  primaryKey({ columns: [table.variantId, table.optionValueId], name: "product_variant_option_pkey" }),
]);

export const productVariantPriceSet = pgTable("product_variant_price_set", {
  variantId: varchar("variant_id", { length: 255 }).notNull(),
  priceSetId: varchar("price_set_id", { length: 255 }).notNull(),
  id: varchar({ length: 255 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  primaryKey({ columns: [table.variantId, table.priceSetId], name: "product_variant_price_set_pkey" }),
  index("IDX_deleted_at_52b23597").using("btree", table.deletedAt.asc().nullsLast()),
  index("IDX_id_52b23597").using("btree", table.id.asc().nullsLast()),
  index("IDX_price_set_id_52b23597").using("btree", table.priceSetId.asc().nullsLast()),
  index("IDX_variant_id_52b23597").using("btree", table.variantId.asc().nullsLast()),
]);

export const productVariantProductImage = pgTable("product_variant_product_image", {
  id: text().primaryKey(),
  variantId: text("variant_id").notNull(),
  imageId: text("image_id").notNull().references(() => image.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("IDX_product_variant_product_image_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_product_variant_product_image_image_id").using("btree", table.imageId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_product_variant_product_image_variant_id").using("btree", table.variantId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const promotion = pgTable("promotion", {
  id: text().primaryKey(),
  code: text().notNull(),
  campaignId: text("campaign_id").references(() => promotionCampaign.id, { onDelete: "set null", onUpdate: "cascade" }),
  isAutomatic: boolean("is_automatic").default(false).notNull(),
  type: text().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  status: text().default("draft").notNull(),
  isTaxInclusive: boolean("is_tax_inclusive").default(false).notNull(),
}, (table) => [
  index("IDX_promotion_campaign_id").using("btree", table.campaignId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_promotion_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_promotion_is_automatic").using("btree", table.isAutomatic.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_promotion_status").using("btree", table.status.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_promotion_type").using("btree", table.type.asc().nullsLast()),
  uniqueIndex("IDX_unique_promotion_code").using("btree", table.code.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  check("promotion_status_check", sql`(status = ANY (ARRAY['draft'::text, 'active'::text, 'inactive'::text]))`), check("promotion_type_check", sql`(type = ANY (ARRAY['standard'::text, 'buyget'::text]))`),]);

export const promotionApplicationMethod = pgTable("promotion_application_method", {
  id: text().primaryKey(),
  value: numeric(),
  rawValue: jsonb("raw_value"),
  maxQuantity: integer("max_quantity"),
  applyToQuantity: integer("apply_to_quantity"),
  buyRulesMinQuantity: integer("buy_rules_min_quantity"),
  type: text().notNull(),
  targetType: text("target_type").notNull(),
  allocation: text(),
  promotionId: text("promotion_id").notNull().references(() => promotion.id, { onDelete: "cascade", onUpdate: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  currencyCode: text("currency_code"),
}, (table) => [
  index("IDX_application_method_allocation").using("btree", table.allocation.asc().nullsLast()),
  index("IDX_application_method_target_type").using("btree", table.targetType.asc().nullsLast()),
  index("IDX_application_method_type").using("btree", table.type.asc().nullsLast()),
  index("IDX_promotion_application_method_currency_code").using("btree", table.currencyCode.asc().nullsLast()).where(sql`(deleted_at IS NOT NULL)`),
  index("IDX_promotion_application_method_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  uniqueIndex("IDX_promotion_application_method_promotion_id_unique").using("btree", table.promotionId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  check("promotion_application_method_allocation_check", sql`(allocation = ANY (ARRAY['each'::text, 'across'::text, 'once'::text]))`), check("promotion_application_method_target_type_check", sql`(target_type = ANY (ARRAY['order'::text, 'shipping_methods'::text, 'items'::text]))`), check("promotion_application_method_type_check", sql`(type = ANY (ARRAY['fixed'::text, 'percentage'::text]))`),]);

export const promotionCampaign = pgTable("promotion_campaign", {
  id: text().primaryKey(),
  name: text().notNull(),
  description: text(),
  campaignIdentifier: text("campaign_identifier").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("IDX_promotion_campaign_campaign_identifier_unique").using("btree", table.campaignIdentifier.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_promotion_campaign_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const promotionCampaignBudget = pgTable("promotion_campaign_budget", {
  id: text().primaryKey(),
  type: text().notNull(),
  campaignId: text("campaign_id").notNull().references(() => promotionCampaign.id, { onDelete: "cascade", onUpdate: "cascade" }),
  limit: numeric(),
  rawLimit: jsonb("raw_limit"),
  used: numeric({ mode: 'number' }).default(0).notNull(),
  rawUsed: jsonb("raw_used").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  currencyCode: text("currency_code"),
  attribute: text(),
}, (table) => [
  index("IDX_campaign_budget_type").using("btree", table.type.asc().nullsLast()),
  uniqueIndex("IDX_promotion_campaign_budget_campaign_id_unique").using("btree", table.campaignId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_promotion_campaign_budget_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  check("promotion_campaign_budget_type_check", sql`(type = ANY (ARRAY['spend'::text, 'usage'::text, 'use_by_attribute'::text, 'spend_by_attribute'::text]))`),]);

export const promotionCampaignBudgetUsage = pgTable("promotion_campaign_budget_usage", {
  id: text().primaryKey(),
  attributeValue: text("attribute_value").notNull(),
  used: numeric({ mode: 'number' }).default(0).notNull(),
  budgetId: text("budget_id").notNull().references(() => promotionCampaignBudget.id, { onDelete: "cascade", onUpdate: "cascade" }),
  rawUsed: jsonb("raw_used").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("IDX_promotion_campaign_budget_usage_attribute_value_budget_id_u").using("btree", table.attributeValue.asc().nullsLast(), table.budgetId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_promotion_campaign_budget_usage_budget_id").using("btree", table.budgetId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_promotion_campaign_budget_usage_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const promotionPromotionRule = pgTable("promotion_promotion_rule", {
  promotionId: text("promotion_id").notNull().references(() => promotion.id, { onDelete: "cascade", onUpdate: "cascade" }),
  promotionRuleId: text("promotion_rule_id").notNull().references(() => promotionRule.id, { onDelete: "cascade", onUpdate: "cascade" }),
}, (table) => [
  primaryKey({ columns: [table.promotionId, table.promotionRuleId], name: "promotion_promotion_rule_pkey" }),
]);

export const promotionRule = pgTable("promotion_rule", {
  id: text().primaryKey(),
  description: text(),
  attribute: text().notNull(),
  operator: text().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("IDX_promotion_rule_attribute").using("btree", table.attribute.asc().nullsLast()),
  index("IDX_promotion_rule_attribute_operator").using("btree", table.attribute.asc().nullsLast(), table.operator.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_promotion_rule_attribute_operator_id").using("btree", table.operator.asc().nullsLast(), table.attribute.asc().nullsLast(), table.id.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_promotion_rule_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_promotion_rule_operator").using("btree", table.operator.asc().nullsLast()),
  check("promotion_rule_operator_check", sql`(operator = ANY (ARRAY['gte'::text, 'lte'::text, 'gt'::text, 'lt'::text, 'eq'::text, 'ne'::text, 'in'::text]))`),]);

export const promotionRuleValue = pgTable("promotion_rule_value", {
  id: text().primaryKey(),
  promotionRuleId: text("promotion_rule_id").notNull().references(() => promotionRule.id, { onDelete: "cascade", onUpdate: "cascade" }),
  value: text().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("IDX_promotion_rule_value_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_promotion_rule_value_promotion_rule_id").using("btree", table.promotionRuleId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_promotion_rule_value_rule_id_value").using("btree", table.promotionRuleId.asc().nullsLast(), table.value.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_promotion_rule_value_value").using("btree", table.value.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const providerIdentity = pgTable("provider_identity", {
  id: text().primaryKey(),
  entityId: text("entity_id").notNull(),
  provider: text().notNull(),
  authIdentityId: text("auth_identity_id").notNull().references(() => authIdentity.id, { onDelete: "cascade", onUpdate: "cascade" }),
  userMetadata: jsonb("user_metadata"),
  providerMetadata: jsonb("provider_metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("IDX_provider_identity_auth_identity_id").using("btree", table.authIdentityId.asc().nullsLast()),
  index("IDX_provider_identity_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  uniqueIndex("IDX_provider_identity_provider_entity_id").using("btree", table.entityId.asc().nullsLast(), table.provider.asc().nullsLast()),
]);

export const publishableApiKeySalesChannel = pgTable("publishable_api_key_sales_channel", {
  publishableKeyId: varchar("publishable_key_id", { length: 255 }).notNull(),
  salesChannelId: varchar("sales_channel_id", { length: 255 }).notNull(),
  id: varchar({ length: 255 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  primaryKey({ columns: [table.publishableKeyId, table.salesChannelId], name: "publishable_api_key_sales_channel_pkey" }),
  index("IDX_deleted_at_-1d67bae40").using("btree", table.deletedAt.asc().nullsLast()),
  index("IDX_id_-1d67bae40").using("btree", table.id.asc().nullsLast()),
  index("IDX_publishable_key_id_-1d67bae40").using("btree", table.publishableKeyId.asc().nullsLast()),
  index("IDX_sales_channel_id_-1d67bae40").using("btree", table.salesChannelId.asc().nullsLast()),
]);

export const refund = pgTable("refund", {
  id: text().primaryKey(),
  amount: numeric().notNull(),
  rawAmount: jsonb("raw_amount").notNull(),
  paymentId: text("payment_id").notNull().references(() => payment.id, { onDelete: "cascade", onUpdate: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdBy: text("created_by"),
  metadata: jsonb(),
  refundReasonId: text("refund_reason_id"),
  note: text(),
}, (table) => [
  index("IDX_refund_deleted_at").using("btree", table.deletedAt.asc().nullsLast()),
  index("IDX_refund_payment_id").using("btree", table.paymentId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_refund_refund_reason_id").using("btree", table.refundReasonId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const refundReason = pgTable("refund_reason", {
  id: text().primaryKey(),
  label: text().notNull(),
  description: text(),
  metadata: jsonb(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  code: text().notNull(),
}, (table) => [
  index("IDX_refund_reason_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const region = pgTable("region", {
  id: text().primaryKey(),
  name: text().notNull(),
  currencyCode: text("currency_code").notNull(),
  metadata: jsonb(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  automaticTaxes: boolean("automatic_taxes").default(true).notNull(),
}, (table) => [
  index("IDX_region_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NOT NULL)`),
]);

export const regionCountry = pgTable("region_country", {
  iso2: text("iso_2").primaryKey(),
  iso3: text("iso_3").notNull(),
  numCode: text("num_code").notNull(),
  name: text().notNull(),
  displayName: text("display_name").notNull(),
  regionId: text("region_id").references(() => region.id, { onDelete: "set null", onUpdate: "cascade" }),
  metadata: jsonb(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("IDX_region_country_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_region_country_region_id").using("btree", table.regionId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  uniqueIndex("IDX_region_country_region_id_iso_2_unique").using("btree", table.regionId.asc().nullsLast(), table.iso2.asc().nullsLast()),
]);

export const regionPaymentProvider = pgTable("region_payment_provider", {
  regionId: varchar("region_id", { length: 255 }).notNull(),
  paymentProviderId: varchar("payment_provider_id", { length: 255 }).notNull(),
  id: varchar({ length: 255 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  primaryKey({ columns: [table.regionId, table.paymentProviderId], name: "region_payment_provider_pkey" }),
  index("IDX_deleted_at_1c934dab0").using("btree", table.deletedAt.asc().nullsLast()),
  index("IDX_id_1c934dab0").using("btree", table.id.asc().nullsLast()),
  index("IDX_payment_provider_id_1c934dab0").using("btree", table.paymentProviderId.asc().nullsLast()),
  index("IDX_region_id_1c934dab0").using("btree", table.regionId.asc().nullsLast()),
]);

export const reservationItem = pgTable("reservation_item", {
  id: text().primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  lineItemId: text("line_item_id"),
  locationId: text("location_id").notNull(),
  quantity: numeric().notNull(),
  externalId: text("external_id"),
  description: text(),
  createdBy: text("created_by"),
  metadata: jsonb(),
  inventoryItemId: text("inventory_item_id").notNull().references(() => inventoryItem.id, { onDelete: "cascade", onUpdate: "cascade" }),
  allowBackorder: boolean("allow_backorder").default(false),
  rawQuantity: jsonb("raw_quantity"),
}, (table) => [
  index("IDX_reservation_item_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NOT NULL)`),
  index("IDX_reservation_item_inventory_item_id").using("btree", table.inventoryItemId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_reservation_item_line_item_id").using("btree", table.lineItemId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_reservation_item_location_id").using("btree", table.locationId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const returnTable = pgTable("return", {
  id: text().primaryKey(),
  orderId: text("order_id").notNull(),
  claimId: text("claim_id"),
  exchangeId: text("exchange_id"),
  orderVersion: integer("order_version").notNull(),
  displayId: serial("display_id").notNull(),
  status: returnStatusEnum().default("open").notNull(),
  noNotification: boolean("no_notification"),
  refundAmount: numeric("refund_amount"),
  rawRefundAmount: jsonb("raw_refund_amount"),
  metadata: jsonb(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  canceledAt: timestamp("canceled_at", { withTimezone: true }),
  locationId: text("location_id"),
  requestedAt: timestamp("requested_at", { withTimezone: true }),
  createdBy: text("created_by"),
}, (table) => [
  index("IDX_return_claim_id").using("btree", table.claimId.asc().nullsLast()).where(sql`((claim_id IS NOT NULL) AND (deleted_at IS NULL))`),
  index("IDX_return_display_id").using("btree", table.displayId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_return_exchange_id").using("btree", table.exchangeId.asc().nullsLast()).where(sql`((exchange_id IS NOT NULL) AND (deleted_at IS NULL))`),
  index("IDX_return_order_id").using("btree", table.orderId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const returnFulfillment = pgTable("return_fulfillment", {
  returnId: varchar("return_id", { length: 255 }).notNull(),
  fulfillmentId: varchar("fulfillment_id", { length: 255 }).notNull(),
  id: varchar({ length: 255 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  primaryKey({ columns: [table.returnId, table.fulfillmentId], name: "return_fulfillment_pkey" }),
  index("IDX_deleted_at_-31ea43a").using("btree", table.deletedAt.asc().nullsLast()),
  index("IDX_fulfillment_id_-31ea43a").using("btree", table.fulfillmentId.asc().nullsLast()),
  index("IDX_id_-31ea43a").using("btree", table.id.asc().nullsLast()),
  index("IDX_return_id_-31ea43a").using("btree", table.returnId.asc().nullsLast()),
]);

export const returnItem = pgTable("return_item", {
  id: text().primaryKey(),
  returnId: text("return_id").notNull(),
  reasonId: text("reason_id"),
  itemId: text("item_id").notNull(),
  quantity: numeric().notNull(),
  rawQuantity: jsonb("raw_quantity").notNull(),
  receivedQuantity: numeric("received_quantity", { mode: 'number' }).default(0).notNull(),
  rawReceivedQuantity: jsonb("raw_received_quantity").notNull(),
  note: text(),
  metadata: jsonb(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  damagedQuantity: numeric("damaged_quantity", { mode: 'number' }).default(0).notNull(),
  rawDamagedQuantity: jsonb("raw_damaged_quantity").notNull(),
}, (table) => [
  index("IDX_return_item_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_return_item_item_id").using("btree", table.itemId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_return_item_reason_id").using("btree", table.reasonId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_return_item_return_id").using("btree", table.returnId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const returnReason = pgTable("return_reason", {
  id: varchar().primaryKey(),
  value: varchar().notNull(),
  label: varchar().notNull(),
  description: varchar(),
  metadata: jsonb(),
  parentReturnReasonId: varchar("parent_return_reason_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  foreignKey({
    columns: [table.parentReturnReasonId],
    foreignColumns: [table.id],
    name: "return_reason_parent_return_reason_id_foreign"
  }),
  index("IDX_return_reason_parent_return_reason_id").using("btree", table.parentReturnReasonId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_return_reason_value").using("btree", table.value.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const salesChannel = pgTable("sales_channel", {
  id: text().primaryKey(),
  name: text().notNull(),
  description: text(),
  isDisabled: boolean("is_disabled").default(false).notNull(),
  metadata: jsonb(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("IDX_sales_channel_deleted_at").using("btree", table.deletedAt.asc().nullsLast()),
]);

export const salesChannelStockLocation = pgTable("sales_channel_stock_location", {
  salesChannelId: varchar("sales_channel_id", { length: 255 }).notNull(),
  stockLocationId: varchar("stock_location_id", { length: 255 }).notNull(),
  id: varchar({ length: 255 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  primaryKey({ columns: [table.salesChannelId, table.stockLocationId], name: "sales_channel_stock_location_pkey" }),
  index("IDX_deleted_at_26d06f470").using("btree", table.deletedAt.asc().nullsLast()),
  index("IDX_id_26d06f470").using("btree", table.id.asc().nullsLast()),
  index("IDX_sales_channel_id_26d06f470").using("btree", table.salesChannelId.asc().nullsLast()),
  index("IDX_stock_location_id_26d06f470").using("btree", table.stockLocationId.asc().nullsLast()),
]);

export const scriptMigrations = pgTable("script_migrations", {
  id: serial().primaryKey(),
  scriptName: varchar("script_name", { length: 255 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("idx_script_name_unique").using("btree", table.scriptName.asc().nullsLast()),
]);

export const serviceZone = pgTable("service_zone", {
  id: text().primaryKey(),
  name: text().notNull(),
  metadata: jsonb(),
  fulfillmentSetId: text("fulfillment_set_id").notNull().references(() => fulfillmentSet.id, { onDelete: "cascade", onUpdate: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("IDX_service_zone_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NOT NULL)`),
  index("IDX_service_zone_fulfillment_set_id").using("btree", table.fulfillmentSetId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  uniqueIndex("IDX_service_zone_name_unique").using("btree", table.name.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const shippingOption = pgTable("shipping_option", {
  id: text().primaryKey(),
  name: text().notNull(),
  priceType: text("price_type").default("flat").notNull(),
  serviceZoneId: text("service_zone_id").notNull().references(() => serviceZone.id, { onDelete: "cascade", onUpdate: "cascade" }),
  shippingProfileId: text("shipping_profile_id").references(() => shippingProfile.id, { onDelete: "set null", onUpdate: "cascade" }),
  providerId: text("provider_id").references(() => fulfillmentProvider.id, { onDelete: "set null", onUpdate: "cascade" }),
  data: jsonb(),
  metadata: jsonb(),
  shippingOptionTypeId: text("shipping_option_type_id").notNull().references(() => shippingOptionType.id, { onUpdate: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("IDX_shipping_option_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NOT NULL)`),
  index("IDX_shipping_option_provider_id").using("btree", table.providerId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_shipping_option_service_zone_id").using("btree", table.serviceZoneId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_shipping_option_shipping_profile_id").using("btree", table.shippingProfileId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  check("shipping_option_price_type_check", sql`(price_type = ANY (ARRAY['calculated'::text, 'flat'::text]))`),]);

export const shippingOptionPriceSet = pgTable("shipping_option_price_set", {
  shippingOptionId: varchar("shipping_option_id", { length: 255 }).notNull(),
  priceSetId: varchar("price_set_id", { length: 255 }).notNull(),
  id: varchar({ length: 255 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  primaryKey({ columns: [table.shippingOptionId, table.priceSetId], name: "shipping_option_price_set_pkey" }),
  index("IDX_deleted_at_ba32fa9c").using("btree", table.deletedAt.asc().nullsLast()),
  index("IDX_id_ba32fa9c").using("btree", table.id.asc().nullsLast()),
  index("IDX_price_set_id_ba32fa9c").using("btree", table.priceSetId.asc().nullsLast()),
  index("IDX_shipping_option_id_ba32fa9c").using("btree", table.shippingOptionId.asc().nullsLast()),
]);

export const shippingOptionRule = pgTable("shipping_option_rule", {
  id: text().primaryKey(),
  attribute: text().notNull(),
  operator: text().notNull(),
  value: jsonb(),
  shippingOptionId: text("shipping_option_id").notNull().references(() => shippingOption.id, { onDelete: "cascade", onUpdate: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("IDX_shipping_option_rule_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NOT NULL)`),
  index("IDX_shipping_option_rule_shipping_option_id").using("btree", table.shippingOptionId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  check("shipping_option_rule_operator_check", sql`(operator = ANY (ARRAY['in'::text, 'eq'::text, 'ne'::text, 'gt'::text, 'gte'::text, 'lt'::text, 'lte'::text, 'nin'::text]))`),]);

export const shippingOptionType = pgTable("shipping_option_type", {
  id: text().primaryKey(),
  label: text().notNull(),
  description: text(),
  code: text().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("IDX_shipping_option_type_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NOT NULL)`),
]);

export const shippingProfile = pgTable("shipping_profile", {
  id: text().primaryKey(),
  name: text().notNull(),
  type: text().notNull(),
  metadata: jsonb(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("IDX_shipping_profile_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NOT NULL)`),
  uniqueIndex("IDX_shipping_profile_name_unique").using("btree", table.name.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const stockLocation = pgTable("stock_location", {
  id: text().primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  name: text().notNull(),
  addressId: text("address_id").references(() => stockLocationAddress.id, { onDelete: "cascade", onUpdate: "cascade" }),
  metadata: jsonb(),
}, (table) => [
  uniqueIndex("IDX_stock_location_address_id_unique").using("btree", table.addressId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_stock_location_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NOT NULL)`),
]);

export const stockLocationAddress = pgTable("stock_location_address", {
  id: text().primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  address1: text("address_1").notNull(),
  address2: text("address_2"),
  company: text(),
  city: text(),
  countryCode: text("country_code").notNull(),
  phone: text(),
  province: text(),
  postalCode: text("postal_code"),
  metadata: jsonb(),
}, (table) => [
  index("IDX_stock_location_address_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NOT NULL)`),
]);

export const store = pgTable("store", {
  id: text().primaryKey(),
  name: text().default("Medusa Store").notNull(),
  defaultSalesChannelId: text("default_sales_channel_id"),
  defaultRegionId: text("default_region_id"),
  defaultLocationId: text("default_location_id"),
  metadata: jsonb(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("IDX_store_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NOT NULL)`),
]);

export const storeCurrency = pgTable("store_currency", {
  id: text().primaryKey(),
  currencyCode: text("currency_code").notNull(),
  isDefault: boolean("is_default").default(false).notNull(),
  storeId: text("store_id").references(() => store.id, { onDelete: "cascade", onUpdate: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("IDX_store_currency_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NOT NULL)`),
  index("IDX_store_currency_store_id").using("btree", table.storeId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const taxProvider = pgTable("tax_provider", {
  id: text().primaryKey(),
  isEnabled: boolean("is_enabled").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("IDX_tax_provider_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const taxRate = pgTable("tax_rate", {
  id: text().primaryKey(),
  rate: real(),
  code: text().notNull(),
  name: text().notNull(),
  isDefault: boolean("is_default").default(false).notNull(),
  isCombinable: boolean("is_combinable").default(false).notNull(),
  taxRegionId: text("tax_region_id").notNull().references(() => taxRegion.id, { onDelete: "cascade" }),
  metadata: jsonb(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  createdBy: text("created_by"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("IDX_single_default_region").using("btree", table.taxRegionId.asc().nullsLast()).where(sql`((is_default = true) AND (deleted_at IS NULL))`),
  index("IDX_tax_rate_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NOT NULL)`),
  index("IDX_tax_rate_tax_region_id").using("btree", table.taxRegionId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const taxRateRule = pgTable("tax_rate_rule", {
  id: text().primaryKey(),
  taxRateId: text("tax_rate_id").notNull().references(() => taxRate.id, { onDelete: "cascade" }),
  referenceId: text("reference_id").notNull(),
  reference: text().notNull(),
  metadata: jsonb(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  createdBy: text("created_by"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("IDX_tax_rate_rule_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NOT NULL)`),
  index("IDX_tax_rate_rule_reference_id").using("btree", table.referenceId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_tax_rate_rule_tax_rate_id").using("btree", table.taxRateId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  uniqueIndex("IDX_tax_rate_rule_unique_rate_reference").using("btree", table.taxRateId.asc().nullsLast(), table.referenceId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const taxRegion = pgTable("tax_region", {
  id: text().primaryKey(),
  providerId: text("provider_id").references(() => taxProvider.id, { onDelete: "set null" }),
  countryCode: text("country_code").notNull(),
  provinceCode: text("province_code"),
  parentId: text("parent_id"),
  metadata: jsonb(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  createdBy: text("created_by"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  foreignKey({
    columns: [table.parentId],
    foreignColumns: [table.id],
    name: "FK_tax_region_parent_id"
  }).onDelete("cascade"),
  index("IDX_tax_region_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NOT NULL)`),
  index("IDX_tax_region_parent_id").using("btree", table.parentId.asc().nullsLast()),
  index("IDX_tax_region_provider_id").using("btree", table.providerId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  uniqueIndex("IDX_tax_region_unique_country_nullable_province").using("btree", table.countryCode.asc().nullsLast()).where(sql`((province_code IS NULL) AND (deleted_at IS NULL))`),
  uniqueIndex("IDX_tax_region_unique_country_province").using("btree", table.countryCode.asc().nullsLast(), table.provinceCode.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  check("CK_tax_region_country_top_level", sql`((parent_id IS NULL) OR (province_code IS NOT NULL))`), check("CK_tax_region_provider_top_level", sql`((parent_id IS NULL) OR (provider_id IS NULL))`),]);

export const user = pgTable("user", {
  id: text().primaryKey(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  email: text().notNull(),
  avatarUrl: text("avatar_url"),
  metadata: jsonb(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("IDX_user_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NOT NULL)`),
  uniqueIndex("IDX_user_email_unique").using("btree", table.email.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const userPreference = pgTable("user_preference", {
  id: text().primaryKey(),
  userId: text("user_id").notNull(),
  key: text().notNull(),
  value: jsonb().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("IDX_user_preference_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_user_preference_user_id").using("btree", table.userId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  uniqueIndex("IDX_user_preference_user_id_key_unique").using("btree", table.userId.asc().nullsLast(), table.key.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const viewConfiguration = pgTable("view_configuration", {
  id: text().primaryKey(),
  entity: text().notNull(),
  name: text(),
  userId: text("user_id"),
  isSystemDefault: boolean("is_system_default").default(false).notNull(),
  configuration: jsonb().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("IDX_view_configuration_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_view_configuration_entity_is_system_default").using("btree", table.entity.asc().nullsLast(), table.isSystemDefault.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_view_configuration_entity_user_id").using("btree", table.entity.asc().nullsLast(), table.userId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_view_configuration_user_id").using("btree", table.userId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);

export const workflowExecution = pgTable("workflow_execution", {
  id: varchar().notNull(),
  workflowId: varchar("workflow_id").notNull(),
  transactionId: varchar("transaction_id").notNull(),
  execution: jsonb(),
  context: jsonb(),
  state: varchar().notNull(),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`now()`).notNull(),
  deletedAt: timestamp("deleted_at"),
  retentionTime: integer("retention_time"),
  runId: text("run_id").default("01K6E7KB2ERVDBSSY23PEEX82H").notNull(),
}, (table) => [
  primaryKey({ columns: [table.workflowId, table.transactionId, table.runId], name: "workflow_execution_pkey" }),
  index("IDX_workflow_execution_deleted_at").using("btree", table.deletedAt.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_workflow_execution_id").using("btree", table.id.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_workflow_execution_retention_time_updated_at_state").using("btree", table.retentionTime.asc().nullsLast(), table.updatedAt.asc().nullsLast(), table.state.asc().nullsLast()).where(sql`((deleted_at IS NULL) AND (retention_time IS NOT NULL))`),
  index("IDX_workflow_execution_run_id").using("btree", table.runId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_workflow_execution_state").using("btree", table.state.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_workflow_execution_state_updated_at").using("btree", table.state.asc().nullsLast(), table.updatedAt.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_workflow_execution_transaction_id").using("btree", table.transactionId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_workflow_execution_updated_at_retention_time").using("btree", table.updatedAt.asc().nullsLast(), table.retentionTime.asc().nullsLast()).where(sql`((deleted_at IS NULL) AND (retention_time IS NOT NULL) AND ((state)::text = ANY (ARRAY[('done'::character varying)::text, ('failed'::character varying)::text, ('reverted'::character varying)::text])))`),
  index("IDX_workflow_execution_workflow_id").using("btree", table.workflowId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  index("IDX_workflow_execution_workflow_id_transaction_id").using("btree", table.workflowId.asc().nullsLast(), table.transactionId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
  uniqueIndex("IDX_workflow_execution_workflow_id_transaction_id_run_id_unique").using("btree", table.workflowId.asc().nullsLast(), table.transactionId.asc().nullsLast(), table.runId.asc().nullsLast()).where(sql`(deleted_at IS NULL)`),
]);
