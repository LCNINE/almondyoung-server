// 홈 브랜드 섹션에 올릴 브랜드 목록을 고르는 순수 로직.
// 입력은 루트 카테고리 트리(listRootCategoriesCached 결과) — 이미 rank 정렬·비활성/회원전용
// 필터가 끝난 상태라 여기서는 브랜드 루트를 찾아 자식을 자르기만 한다.

export interface BrandTileCategory {
  id: string
  name: string
  handle: string
  metadata?: Record<string, unknown> | null
  category_children?: BrandTileCategory[] | null
}

export interface BrandTileSelection<T extends BrandTileCategory> {
  brands: T[]
  hasMore: boolean
}

export function selectBrandTiles<T extends BrandTileCategory>(
  rootCategories: T[],
  brandRootHandle: string,
  maxTiles: number
): BrandTileSelection<T> {
  const brandRoot = rootCategories.find((c) => c.handle === brandRootHandle)
  const children = (brandRoot?.category_children ?? []) as T[]

  return {
    brands: children.slice(0, maxTiles),
    hasMore: children.length > maxTiles,
  }
}
