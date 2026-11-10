import { getTranslations } from "next-intl/server"
import { SectionHead } from "@/domains/home/components/header"
import { HomeRail } from "@/domains/home/components/shared/home-rail"
import { HomeSection } from "@/domains/home/components/shared/home-section"
import ProductCard from "@/domains/products/components/product-card"
import { getHideMembershipPriceForNonMembers } from "@/lib/utils/product-card"
import { MEMBERSHIP_HALL_PATH } from "../utils/hall-params"
import { loadHallProducts } from "../utils/load-hall-products"

const SECTION_LIMIT = 10

/** 메인 멤버십관 띠. 상품이 하나도 없으면 띠째 빠진다 */
export async function MembershipHallSection({
  countryCode,
  banner,
}: {
  countryCode: string
  /** PC 에서 상품 목록 위에 두는 멤버십 띠배너. 모바일은 안내 없이 상품만 보인다 */
  banner?: React.ReactNode
}) {
  const [{ products, isMember, wishlistIds }, t] = await Promise.all([
    loadHallProducts({
      countryCode,
      tab: "all",
      sort: "sales",
      limit: SECTION_LIMIT,
      offset: 0,
    }),
    getTranslations("membershipHall"),
  ])

  if (products.length === 0) return null

  const wishlist = new Set(wishlistIds)

  return (
    <HomeSection>
      <SectionHead
        title={t("title")}
        accent={t("section.titleAccent")}
        subtitle={t("section.subtitle")}
        moreHref={MEMBERSHIP_HALL_PATH}
        moreLabel={t("section.viewAll")}
      />

      {banner && (
        <div className="mb-6 hidden overflow-hidden rounded-2xl md:block">
          {banner}
        </div>
      )}

      <HomeRail>
        {products.map((product) => (
          <ProductCard
            key={product.id}
            product={product}
            isMembership={isMember}
            isMembershipOnly={getHideMembershipPriceForNonMembers(product)}
            isWishlisted={wishlist.has(product.id ?? "")}
            countryCode={countryCode}
            enablePhotoSwipe={false}
          />
        ))}
      </HomeRail>
    </HomeSection>
  )
}
