/**
 * 목록 카드가 그리는 데 필요한 Medusa 필드.
 *
 * `products.ts` 는 `"use server"` 라 async 가 아닌 export 를 둘 수 없다 — 두면 tsc 는 통과하고
 * Next 빌드에서 깨진다. 그래서 상수는 여기 둔다.
 */
export const PRODUCT_LIST_FIELDS =
  "*variants.calculated_price,+variants.inventory_quantity,+variants.manage_inventory,+variants.allow_backorder,+variants.metadata,*variants.options,+metadata,+tags,"

/** 타임세일 섹션은 탭을 상품의 카테고리에서 역산하므로 카테고리 id 가 더 필요하다. */
export const PRODUCT_LIST_FIELDS_WITH_CATEGORIES = `${PRODUCT_LIST_FIELDS}*categories,`
