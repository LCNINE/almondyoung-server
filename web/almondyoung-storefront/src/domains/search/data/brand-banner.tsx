import "server-only"
import { getCategoryThumbnail } from "@/domains/category/utils/category-thumbnail"
import { selectBrandTiles } from "@/domains/home/template/brand-showcase/select-brand-tiles"
import { BRAND_CATEGORY_HANDLE } from "@/lib/constants/brand"
import { listRootCategoriesCached } from "@/lib/data/category"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import { SearchBrandBanner } from "../components/search-brand-banner"
import { matchBrandForQuery } from "../utils/match-brand"

/**
 * 검색어가 브랜드관 브랜드와 매칭되면 결과 최상단에 띄울 카드를 만든다.
 *
 * listRootCategoriesCached 는 비활성·회원전용 필터가 끝난 트리라(헤더와 공유, 요청당 1회)
 * 회원전용 브랜드 카드는 멤버십 회원에게만 뜬다.
 * 장식이므로 실패는 null 로 흡수한다 — 배너 때문에 검색 페이지가 죽으면 안 된다.
 */
export async function resolveBrandBanner(
  keyword: string
): Promise<React.ReactNode> {
  if (!keyword) return null

  try {
    const roots = await listRootCategoriesCached()
    const { groups } = selectBrandTiles(roots, BRAND_CATEGORY_HANDLE, Infinity)
    const tiles = groups.flatMap((g) => g.brands)
    const hit = matchBrandForQuery(
      tiles.map((b) => ({ name: b.category.name, tile: b })),
      keyword
    )
    if (!hit) return null

    const thumbnail = getCategoryThumbnail(hit.tile.category)
    return (
      <SearchBrandBanner
        name={hit.tile.category.name}
        href={`/category/${hit.tile.handlePath.join("/")}`}
        thumbnailUrl={thumbnail ? getThumbnailUrl(thumbnail) : null}
      />
    )
  } catch (error) {
    console.error("[search] 브랜드 배너 매칭 실패:", error)
    return null
  }
}
