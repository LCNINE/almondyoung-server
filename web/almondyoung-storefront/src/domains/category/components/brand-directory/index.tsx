import { BrandTile } from "@/domains/home/template/brand-showcase/brand-tile"
import { selectBrandTiles } from "@/domains/home/template/brand-showcase/select-brand-tiles"
import { getCategoryThumbnail } from "@/domains/category/utils/category-thumbnail"
import type { StoreProductCategoryTree } from "@/lib/types/medusa-category"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"

// 그룹당 노출 상한. 브랜드관 페이지는 목록이 목적이라 홈보다 넉넉히 둔다.
const MAX_TILES = 60

interface BrandDirectoryProps {
  /** 브랜드관 루트 또는 그룹(중간 분류) 카테고리 */
  category: StoreProductCategoryTree
  /** 현재 페이지의 URL 세그먼트 경로 (하위 링크의 접두 경로) */
  basePath?: string
}

/**
 * 브랜드관 루트·그룹 카테고리 페이지의 하위 브랜드 디렉토리.
 * 일반 카테고리의 원형 내비 대신, 그룹별 섹션 제목 + 정사각 로고 타일
 * 그리드로 보여줘 브랜드관답게 만든다. 홈 브랜드 섹션과 같은 타일 어휘를 쓴다.
 */
export function BrandDirectory({ category, basePath }: BrandDirectoryProps) {
  const { groups } = selectBrandTiles([category], category.handle, MAX_TILES)
  if (groups.length === 0) return null

  const prefix = basePath ? `/category/${basePath}` : `/category/${category.handle}`

  return (
    <div className="flex flex-col gap-8">
      {groups.map((group) => (
        <section key={group.category?.id ?? "direct"}>
          {group.category && (
            <h2 className="mb-4 text-lg font-bold">{group.category.name}</h2>
          )}
          <div className="grid grid-cols-4 gap-x-3 gap-y-5 sm:grid-cols-5 md:grid-cols-7 md:gap-x-4 lg:grid-cols-9">
            {group.brands.map(({ category: brand, handlePath }) => {
              const thumbnail = getCategoryThumbnail(brand)
              return (
                <BrandTile
                  key={brand.id}
                  name={brand.name}
                  // handlePath[0] 은 현재 카테고리 자신 — URL 세그먼트 경로로 치환한다
                  href={`${prefix}/${handlePath.slice(1).join("/")}`}
                  thumbnailUrl={thumbnail ? getThumbnailUrl(thumbnail) : null}
                />
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
