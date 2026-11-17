interface BrandCategory {
  id: string
}

export interface FieldBrand<T extends BrandCategory> {
  category: T
  productIds: string[]
}

/**
 * 분야 상품(각자 붙은 카테고리 id 목록)을 브랜드별로 묶는다.
 * 상품이 하나도 없는 브랜드는 빼고, 상품이 많은 순으로 정렬한다.
 */
export function groupFieldProductsByBrand<T extends BrandCategory>(
  products: { id: string; categoryIds: string[] }[],
  brands: T[]
): FieldBrand<T>[] {
  const byBrand = new Map(brands.map((b) => [b.id, [] as string[]]))

  for (const product of products) {
    for (const categoryId of product.categoryIds) {
      byBrand.get(categoryId)?.push(product.id)
    }
  }

  return brands
    .map((category) => ({ category, productIds: byBrand.get(category.id)! }))
    .filter((b) => b.productIds.length > 0)
    .sort((a, b) => b.productIds.length - a.productIds.length)
}
