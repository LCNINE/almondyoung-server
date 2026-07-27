import { getCategoryByHandle } from "@/lib/api/medusa/categories"
import { retrieveCustomer } from "@/lib/api/medusa/customer"
import { listProducts } from "@/lib/api/medusa/products"
import { getRegion } from "@/lib/api/medusa/regions"
import { collectCategoryIds } from "@/lib/utils/collect-category-ids"
import { getWishlist } from "@lib/api/users/wishlist"
import { getTranslations } from "next-intl/server"
import { ShowcaseSection } from "../../components/sections/showcase-section"

export type ShowcaseCategory = {
  titleKey: "canva" | "class"
  handle: string
  /** 이 자식 카테고리 상품을 섹션 앞쪽에 먼저 깐다 (마진 좋은 상품 우선 노출) */
  priorityHandle?: string
}

// 홈에 통째로 노출하는 루트 카테고리. handle 은 Medusa product_category.handle.
export const SHOWCASE_CATEGORIES: readonly ShowcaseCategory[] = [
  {
    titleKey: "canva",
    handle: "cafe24-cat-345",
    priorityHandle: "cafe24-cat-523",
  },
  { titleKey: "class", handle: "cafe24-cat-86" }, // 클래스 (지역별)
]

const SECTION_LIMIT = 10
// 앞 5칸만 우선 카테고리로 채우고 나머지는 기존 정렬 유지. 한 줄 전부 교재로 깔려면 SECTION_LIMIT 로 올릴 것.
const PRIORITY_LIMIT = 5

export async function ShowcaseCategoryWrapper({
  countryCode,
  titleKey,
  handle,
  priorityHandle,
}: {
  countryCode: string
} & ShowcaseCategory) {
  const [region, category, customer, t] = await Promise.all([
    getRegion(countryCode),
    getCategoryByHandle([handle]),
    retrieveCustomer(),
    getTranslations("home.showcase"),
  ])

  if (!category) return null

  // 이 두 카테고리는 루트에 상품이 직접 달려있지 않고 자식에만 붙어있다. Medusa 의
  // category_id 필터는 정확 일치(자손 미포함)라서 자손 id 를 전부 넘겨야 한다.
  // getCategoryByHandle 이 채워주는 category_children 은 1단계까지 — 현재 두 카테고리
  // 모두 2단 구조라 충분하지만, 손자 depth 가 생기면 조회 fields 를 늘려야 한다.
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
        limit: SECTION_LIMIT,
      },
      regionId: region?.id,
    }),
    priorityCategory
      ? listProducts({
          queryParams: {
            category_id: collectCategoryIds(priorityCategory),
            limit: PRIORITY_LIMIT,
          },
          regionId: region?.id,
        }).then((r) => r.response.products)
      : Promise.resolve([]),
  ])

  const priorityIds = new Set(priorityProducts.map((p) => p.id))
  const sectionProducts = [
    ...priorityProducts,
    ...products.filter((p) => !priorityIds.has(p.id)),
  ].slice(0, SECTION_LIMIT)

  // 판매 상품이 없으면 빈 섹션 대신 아예 렌더링하지 않는다.
  if (sectionProducts.length === 0) return null

  const wishlist = customer ? await getWishlist().catch(() => []) : []

  return (
    <ShowcaseSection
      title={t(titleKey)}
      handle={handle}
      products={sectionProducts}
      customer={customer}
      wishlistIds={new Set(wishlist.map((item) => item.productId))}
    />
  )
}
