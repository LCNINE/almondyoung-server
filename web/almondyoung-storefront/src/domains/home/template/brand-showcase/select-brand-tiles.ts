// 홈 브랜드 섹션에 올릴 브랜드 목록을 고르는 순수 로직.
// 입력은 루트 카테고리 트리(listRootCategoriesCached 결과) — 이미 rank 정렬·비활성/회원전용
// 필터가 끝난 상태라 여기서는 브랜드 루트를 찾아 모양을 정리하기만 한다.
//
// 그룹/브랜드 판정:
//   1순위: 관리자에서 지정한 브랜드 플래그(metadata.isBrand, core displaySettings 동기화).
//          true 면 브랜드(자식이 있어도 타일로 멈춤), false 면 그룹(안으로 재귀).
//   폴백(플래그 미지정, 기존 데이터): 로고가 있거나 리프면 브랜드, 로고 없이 자식만
//          있으면 그룹. 그룹 속 그룹도 깊이 제한 없이 동작.
// 탭은 브랜드관 직계 그룹 단위로 만들고, 각 탭에는 그 그룹 아래 전 깊이의 브랜드가 모인다.
// 직계 브랜드는 맨 앞의 무명 그룹("전체" 탭)으로 묶는다.

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
  /** 무명 그룹(직계 브랜드 묶음)이면 null */
  category: T | null
  brands: BrandTile<T>[]
}

export interface BrandTileSelection<T extends BrandTileCategory> {
  groups: BrandGroup<T>[]
  /** 이름 있는 그룹이 있어 탭 UI 가 필요한가 */
  hasGroups: boolean
}

function hasOwnThumbnail(category: BrandTileCategory): boolean {
  const metadata = category.metadata as
    | { thumbnail?: unknown; imageUrl?: unknown; image_url?: unknown; image?: unknown }
    | null
    | undefined
  const image =
    metadata?.thumbnail ??
    metadata?.imageUrl ??
    metadata?.image_url ??
    metadata?.image
  return typeof image === "string" && image.length > 0
}

/** 이 노드가 브랜드 타일인가(그룹 아님). 카테고리 페이지의 디렉토리 분기에서도 쓴다. */
export function isBrandTileNode(category: BrandTileCategory): boolean {
  return isBrandNode(category)
}

function isBrandNode(category: BrandTileCategory): boolean {
  const isBrand = (category.metadata as { isBrand?: unknown } | null | undefined)
    ?.isBrand
  if (typeof isBrand === "boolean") return isBrand
  const children = category.category_children ?? []
  return hasOwnThumbnail(category) || children.length === 0
}

function collectBrands<T extends BrandTileCategory>(
  nodes: T[],
  parentPath: string[],
  out: BrandTile<T>[]
): void {
  for (const node of nodes) {
    if (isBrandNode(node)) {
      out.push({ category: node, handlePath: [...parentPath, node.handle] })
    } else {
      collectBrands(
        (node.category_children ?? []) as T[],
        [...parentPath, node.handle],
        out
      )
    }
  }
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
    if (isBrandNode(child)) {
      directBrands.push({
        category: child,
        handlePath: [brandRootHandle, child.handle],
      })
    } else {
      const brands: BrandTile<T>[] = []
      collectBrands(
        (child.category_children ?? []) as T[],
        [brandRootHandle, child.handle],
        brands
      )
      groups.push({ category: child, brands: brands.slice(0, maxTilesPerGroup) })
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
