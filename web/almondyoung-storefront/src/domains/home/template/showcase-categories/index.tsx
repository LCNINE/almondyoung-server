import { getCategoryByHandle } from "@/lib/api/medusa/categories"
import { retrieveCustomer } from "@/lib/api/medusa/customer"
import { listProducts } from "@/lib/api/medusa/products"
import { getRegion } from "@/lib/api/medusa/regions"
import { PRODUCT_LIST_FIELDS_WITH_CATEGORIES } from "@lib/data/product-fields"
import { collectCategoryIds } from "@/lib/utils/collect-category-ids"
import { isMembershipGroup } from "@/lib/utils/membership-group"
import { filterProductsByMembershipVisibility } from "@/lib/utils/product-card"
import { filterSoldOut } from "@/domains/products/components/product-card/quantity/stock-status"
import { getTranslations } from "next-intl/server"
import { ClassListSection } from "../../components/class-list"
import {
  toClassRow,
  type ClassRow,
} from "../../components/class-list/class-list-data"
import { SectionHead } from "../../components/header"
import { V1ProductCard } from "../../components/v1-card"
import { toV1CardItems } from "../../components/v1-card/v1-card-data"
import { V1CardGrid } from "../../components/v1-card/v1-card-grid"

export type ShowcaseCategory = {
  titleKey: "canva" | "class" | "newArrivals"
  handle: string
  /** grid5: 5칸 2줄(모바일 2줄 캐러셀) / grid4: 4칸(모바일 한 줄) / classes: 지역 탭 2단 목록 */
  layout: "grid5" | "grid4" | "classes"
  limit: number
  order?: string
  /** 썸네일 위 mint 신상 태그 */
  newTag?: boolean
  /** 이 자식 카테고리 상품을 섹션 앞쪽에 먼저 깐다 (마진 좋은 상품 우선 노출) */
  priorityHandle?: string
}

// 홈에 통째로 노출하는 루트 카테고리. handle 은 Medusa product_category.handle.
export const SHOWCASE_CATEGORIES: readonly ShowcaseCategory[] = [
  {
    titleKey: "canva",
    handle: "cafe24-cat-345",
    priorityHandle: "cafe24-cat-523",
    layout: "grid4",
    limit: 8,
  },
  // 클래스 (지역별 자식 카테고리)
  { titleKey: "class", handle: "cafe24-cat-86", layout: "classes", limit: 12 },
]

export const NEW_ARRIVALS_CATEGORY: ShowcaseCategory = {
  titleKey: "newArrivals",
  handle: "xfpg5f",
  order: "-created_at",
  layout: "grid5",
  limit: 10,
  newTag: true,
}

// 앞쪽 몇 칸만 우선 카테고리로 채우고 나머지는 기존 정렬 유지.
const PRIORITY_LIMIT = 4
// 품절을 걷어내고도 칸을 채우려면 넉넉히 받아야 한다.
const OVERFETCH = 3

export async function ShowcaseCategoryWrapper({
  countryCode,
  titleKey,
  handle,
  layout,
  limit,
  priorityHandle,
  order,
  newTag,
}: {
  countryCode: string
} & ShowcaseCategory) {
  const [region, category, customer, t] = await Promise.all([
    getRegion(countryCode),
    getCategoryByHandle([handle]),
    retrieveCustomer().catch(() => null),
    getTranslations("home.showcase"),
  ])

  if (!category) return null

  const isMember = isMembershipGroup(customer?.groups)
  const fields =
    layout === "classes" ? { fields: PRODUCT_LIST_FIELDS_WITH_CATEGORIES } : {}

  // 이 카테고리들은 루트에 상품이 직접 달려있지 않고 자식에만 붙어있다. Medusa 의
  // category_id 필터는 정확 일치(자손 미포함)라서 자손 id 를 전부 넘겨야 한다.
  const priorityCategory = priorityHandle
    ? category.category_children?.find((c) => c.handle === priorityHandle)
    : undefined

  const [
    {
      response: { products },
    },
    priorityProducts,
  ] = await Promise.all([
    listProducts({
      queryParams: {
        category_id: collectCategoryIds(category),
        limit: limit * OVERFETCH,
        order,
        ...fields,
      },
      regionId: region?.id,
    }),
    priorityCategory
      ? listProducts({
          queryParams: {
            category_id: collectCategoryIds(priorityCategory),
            limit: PRIORITY_LIMIT * OVERFETCH,
          },
          regionId: region?.id,
        }).then((r) =>
          filterSoldOut(r.response.products).slice(0, PRIORITY_LIMIT)
        )
      : Promise.resolve([]),
  ])

  const priorityIds = new Set(priorityProducts.map((p) => p.id))
  const sectionProducts = filterProductsByMembershipVisibility(
    [
      ...priorityProducts,
      ...filterSoldOut(products).filter((p) => !priorityIds.has(p.id)),
    ],
    isMember
  ).slice(0, limit)

  // 판매 상품이 없으면 빈 섹션 대신 아예 렌더링하지 않는다.
  if (sectionProducts.length === 0) return null

  const title = t(titleKey)
  const subtitle = t(`${titleKey}Description`)

  if (layout === "classes") {
    const rows = sectionProducts
      .map((product) => toClassRow(product, isMember))
      .filter((row): row is ClassRow => row !== null)

    return <ClassListSection title={title} subtitle={subtitle} rows={rows} />
  }

  const items = toV1CardItems(sectionProducts, isMember)

  return (
    <div className="w-full">
      <SectionHead
        title={title}
        subtitle={subtitle}
        moreHref={`/category/${handle}`}
        moreVariant="viewAll"
      />
      <V1CardGrid
        columns={layout === "grid5" ? 5 : 4}
        mobileRows={layout === "grid5" ? 2 : 1}
      >
        {items.map((item) => (
          <li key={item.id}>
            <V1ProductCard item={item} tag={newTag ? t("newTag") : undefined} />
          </li>
        ))}
      </V1CardGrid>
    </div>
  )
}
