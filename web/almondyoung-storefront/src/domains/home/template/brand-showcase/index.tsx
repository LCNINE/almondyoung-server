import { getCategoryThumbnail } from "@/domains/category/utils/category-thumbnail"
import { BRAND_CATEGORY_HANDLE } from "@/lib/constants/brand"
import { listRootCategoriesCached } from "@/lib/data/category"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import { getTranslations } from "next-intl/server"
import { Header, MoreButton, Title } from "../../components/header"
import { HomeSection } from "../../components/shared/home-section"
import { BrandStrip, type BrandStripGroup } from "./brand-strip"
import { selectBrandTiles } from "./select-brand-tiles"

// 그룹당 스트립에 올리는 최대 타일 수. 넘치면 더보기(브랜드관)로 보낸다.
const MAX_BRAND_TILES = 16

/**
 * 홈 브랜드 섹션. 데이터는 "브랜드" 루트 카테고리의 자손들 — 헤더 메가메뉴가
 * 이미 요청 단위로 캐시한 listRootCategoriesCached 를 그대로 재사용하므로
 * Medusa 왕복이 추가로 늘지 않는다. 정렬(rank)·비활성/회원전용 필터도 그 경로에서 끝난 상태.
 * 브랜드관이 중간 그룹을 갖는 트리로 재편되면 자동으로 그룹 탭 UI 로 전환된다.
 */
export async function BrandShowcaseWrapper() {
  const [rootCategories, t] = await Promise.all([
    listRootCategoriesCached(),
    getTranslations("home.brands"),
  ])

  const { groups, hasGroups } = selectBrandTiles(
    rootCategories,
    BRAND_CATEGORY_HANDLE,
    MAX_BRAND_TILES
  )

  // 브랜드 카테고리가 없거나 비었으면 섹션 자체를 렌더링하지 않는다.
  if (groups.length === 0) return null

  const stripGroups: BrandStripGroup[] = groups.map((group) => ({
    id: group.category?.id ?? "direct",
    name: group.category?.name ?? null,
    brands: group.brands.map(({ category, handlePath }) => {
      const thumbnail = getCategoryThumbnail(category)
      return {
        id: category.id,
        name: category.name,
        href: `/category/${handlePath.join("/")}`,
        thumbnailUrl: thumbnail ? getThumbnailUrl(thumbnail) : null,
      }
    }),
  }))

  return (
    <HomeSection className="lg:py-16">
      <Header className="mb-5">
        <Title>{t("title")}</Title>
        <MoreButton
          showOnDesktop
          href={`/category/${BRAND_CATEGORY_HANDLE}`}
          className="md:absolute md:right-0"
        />
      </Header>

      <BrandStrip
        groups={stripGroups}
        showTabs={hasGroups}
        labels={{
          prev: t("prev"),
          next: t("next"),
          ariaLabel: t("ariaLabel"),
          all: t("all"),
        }}
      />
    </HomeSection>
  )
}
