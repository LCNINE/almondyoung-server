import { getCategoryByHandle } from "@/lib/api/medusa/categories"
import { retrieveCustomer } from "@/lib/api/medusa/customer"
import { listProductsSorted } from "@/lib/api/medusa/products"
import { getRegion } from "@/lib/api/medusa/regions"
import { collectCategoryIds } from "@/lib/utils/collect-category-ids"
import { getIsMembershipOnly } from "@/lib/utils/product-card"
import { filterSoldOut } from "@/domains/products/components/product-card/quantity/stock-status"
import ProductCard from "@/domains/products/components/product-card"
import RankBadge from "@/domains/products/components/rank-badge"
import { getWishlist } from "@lib/api/users/wishlist"
import { getTranslations } from "next-intl/server"
import { SectionHead } from "../../components/header"
import { HomeRail } from "../../components/shared/home-rail"
import { HomeSection } from "../../components/shared/home-section"

const HANDLE = "9xpr2r"
const SECTION_LIMIT = 10
// 품절을 걷어내고도 SECTION_LIMIT 을 채우려면 넉넉히 받아야 한다.
const OVERFETCH = 3

export async function OverseasShowcaseWrapper({
  countryCode,
}: {
  countryCode: string
}) {
  const [region, category, customer, t] = await Promise.all([
    getRegion(countryCode),
    getCategoryByHandle([HANDLE]),
    retrieveCustomer(),
    getTranslations("home.showcase"),
  ])

  if (!category) return null

  const {
    response: { products: fetched },
  } = await listProductsSorted({
    categoryId: collectCategoryIds(category),
    sortBy: "sales_count",
    order: "desc",
    limit: SECTION_LIMIT * OVERFETCH,
    regionId: region?.id,
  })

  const products = filterSoldOut(fetched).slice(0, SECTION_LIMIT)

  if (products.length === 0) return null

  const wishlist = customer ? await getWishlist().catch(() => []) : []
  const wishlistIds = new Set(wishlist.map((item) => item.productId))

  const isMembership =
    customer?.groups?.some(
      (group) => group.id === process.env.NEXT_PUBLIC_MEDUSA_MEMBERSHIP_GROUP_ID
    ) ?? false

  return (
    <HomeSection background="muted" className="border-t-0">
      <SectionHead
        title={t("overseas")}
        subtitle={t("overseasDescription")}
        moreHref={`/category/${HANDLE}`}
        moreLabel={t("viewAll")}
      />
      <HomeRail>
        {products.map((product, index) => (
          <ProductCard
            key={product.id}
            product={product}
            isMembership={isMembership}
            isMembershipOnly={getIsMembershipOnly(product)}
            isWishlisted={wishlistIds.has(product.id ?? "")}
            overlay={<RankBadge rank={index + 1} />}
            enablePhotoSwipe={false}
          />
        ))}
      </HomeRail>
    </HomeSection>
  )
}
