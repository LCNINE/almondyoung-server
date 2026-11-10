import { filterSoldOut } from "@/domains/products/components/product-card/quantity/stock-status"
import { listProductsSorted } from "@/lib/api/medusa/products"
import { getIsMembershipCustomer } from "@/lib/data/membership"
import { filterProductsByMembershipVisibility } from "@/lib/utils/product-card"
import { getTranslations } from "next-intl/server"
import { HomeSection } from "../../components/shared/home-section"
import { SectionHead } from "../../components/header"
import { V1ProductCard } from "../../components/v1-card"
import { toV1CardItems } from "../../components/v1-card/v1-card-data"
import { V1CardGrid } from "../../components/v1-card/v1-card-grid"
import { resolveCategoryIds } from "../resolve-category-ids"

/** 메이크업 > 일회용품, 헤어 > 일회용품 */
export const DAILY_SUPPLIES_CATEGORY_HANDLES = [
  "cafe24-cat-373",
  "cafe24-cat-423",
] as const

const LIMIT = 6
// 품절을 걷어내고도 칸을 채우려면 넉넉히 받아야 한다.
const OVERFETCH = 3

export async function DailySuppliesWrapper({
  countryCode,
}: {
  countryCode: string
}) {
  const [categoryIds, isMember, t] = await Promise.all([
    resolveCategoryIds(DAILY_SUPPLIES_CATEGORY_HANDLES),
    getIsMembershipCustomer(),
    getTranslations("home.dailySupplies"),
  ])

  if (categoryIds.length === 0) return null

  const {
    response: { products },
  } = await listProductsSorted({
    countryCode,
    categoryId: categoryIds,
    sortBy: "sales_count",
    order: "desc",
    limit: LIMIT * OVERFETCH,
  })

  const visible = filterProductsByMembershipVisibility(
    filterSoldOut(products),
    isMember
  ).slice(0, LIMIT)
  const items = toV1CardItems(visible, isMember)

  if (items.length === 0) return null

  return (
    <HomeSection className="border-t-0">
      <div className="w-full">
        <SectionHead
          title={t("title")}
          accent={t("titleAccent")}
          subtitle={t("subtitle")}
          moreHref={`/category/${DAILY_SUPPLIES_CATEGORY_HANDLES[0]}`}
          moreVariant="viewAll"
        />
        <V1CardGrid columns={6}>
          {items.map((item) => (
            <li key={item.id}>
              <V1ProductCard item={item} compact />
            </li>
          ))}
        </V1CardGrid>
      </div>
    </HomeSection>
  )
}
