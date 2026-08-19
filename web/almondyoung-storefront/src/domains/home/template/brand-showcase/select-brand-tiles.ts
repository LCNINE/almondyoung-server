// 홈 브랜드 섹션에 올릴 브랜드 목록을 고르는 순수 로직.
// 입력은 루트 카테고리 트리(listRootCategoriesCached 결과) — 이미 rank 정렬·비활성/회원전용
// 필터가 끝난 상태라 여기서는 브랜드 루트를 찾아 모양을 정리하기만 한다.
//
// 브랜드관 트리는 두 모양을 지원한다:
//   flat:    브랜드관 → 브랜드들                    (그룹 탭 없음)
//   grouped: 브랜드관 → 중간 그룹(래쉬브랜드관…) → 브랜드들 (그룹별 탭)
// 혼합 상태(그룹과 브랜드가 섞임)면 직계 브랜드들을 맨 앞의 무명 그룹으로 묶는다.

export interface BrandTileCategory {
  id: string
  name: string
  handle: string
  metadata?: Record<string, unknown> | null
  category_children?: BrandTileCategory[] | null
}

export interface BrandTile<T extends BrandTileCategory> {
  category: T
  /** 브랜드관 루트부터 이 브랜드까지의 handle 경로 (링크 세그먼트용) */
  handlePath: string[]
}

export interface BrandGroup<T extends BrandTileCategory> {
  /** 무명 그룹(flat/혼합의 직계 브랜드 묶음)이면 null */
  category: T | null
  brands: BrandTile<T>[]
}

export interface BrandTileSelection<T extends BrandTileCategory> {
  groups: BrandGroup<T>[]
  /** 그룹이 2개 이상이거나 이름 있는 그룹이 있어 탭 UI 가 필요한가 */
  hasGroups: boolean
}

export function selectBrandTiles<T extends BrandTileCategory>(
  rootCategories: T[],
  brandRootHandle: string,
  maxTilesPerGroup: number
): BrandTileSelection<T> {
  const brandRoot = rootCategories.find((c) => c.handle === brandRootHandle)
  const children = (brandRoot?.category_children ?? []) as T[]

  const directBrands: BrandTile<T>[] = []
  const groups: BrandGroup<T>[] = []

  for (const child of children) {
    const grandChildren = (child.category_children ?? []) as T[]
    if (grandChildren.length > 0) {
      groups.push({
        category: child,
        brands: grandChildren.slice(0, maxTilesPerGroup).map((brand) => ({
          category: brand,
          handlePath: [brandRootHandle, child.handle, brand.handle],
        })),
      })
    } else {
      directBrands.push({
        category: child,
        handlePath: [brandRootHandle, child.handle],
      })
    }
  }

  if (directBrands.length > 0) {
    groups.unshift({
      category: null,
      brands: directBrands.slice(0, maxTilesPerGroup),
    })
  }

  return {
    groups: groups.filter((g) => g.brands.length > 0),
    hasGroups: groups.some((g) => g.category !== null),
  }
}
