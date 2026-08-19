// storefront 체크아웃과 동일한 필드셋. 콤마 뒤 `+`/`*` 사이에 공백을 넣으면 Medusa 가 필드를
// 못 알아듣는다 — 원본에서 그대로 옮긴 문자열이니 손대지 말 것.
export const CHECKOUT_CART_FIELDS =
  '*items, +items.requires_shipping, +items.product_type, *items.product, *items.product.metadata, +items.product.shipping_profile.id, *items.product.tags, *items.variant, +items.variant.inventory_quantity, +items.variant.manage_inventory, +items.variant.allow_backorder, *region, *customer, *shipping_methods, *promotions, +item_subtotal, +shipping_total, +total, +discount_total, +items.discount_total, +shipping_methods.discount_total, +payment_collection.id, +currency_code';
