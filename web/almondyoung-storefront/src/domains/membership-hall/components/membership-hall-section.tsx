import Image from "next/image"
import { getTranslations } from "next-intl/server"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { SectionHead } from "@/domains/home/components/header"
import { HomeRail } from "@/domains/home/components/shared/home-rail"
import { HomeSection } from "@/domains/home/components/shared/home-section"
import ProductCard from "@/domains/products/components/product-card"
import { getHideMembershipPriceForNonMembers } from "@/lib/utils/product-card"
import { MEMBERSHIP_HALL_PATH } from "../utils/hall-params"
import { loadHallProducts } from "../utils/load-hall-products"
import { MEMBERSHIP_PAGE_HREF } from "./hall-header"

const SECTION_LIMIT = 10

/** 메인 멤버십관 띠. 상품이 하나도 없으면 띠째 빠진다 */
export async function MembershipHallSection({
  countryCode,
}: {
  countryCode: string
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
    <HomeSection className="bg-purple-tint border-t-0">
      <SectionHead
        title={
          <>
            <Image
              src="/images/almondyoung-symbol.png"
              alt=""
              aria-hidden
              width={28}
              height={28}
              className="size-7 object-contain"
            />
            {t("title")}
          </>
        }
        subtitle={t("section.subtitle")}
        moreHref={MEMBERSHIP_HALL_PATH}
        moreLabel={t("section.viewAll")}
      />

      <div className="mb-6 flex flex-col items-stretch gap-4 rounded-[14px] bg-white px-5 py-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-ink text-[15px] font-bold">
            {isMember ? t("section.memberTitle") : t("section.guestTitle")}
          </p>
          <p className="text-muted-foreground text-[13px]">
            {isMember
              ? t("section.memberDescription")
              : t("section.guestDescription")}
          </p>
        </div>
        <LocalizedClientLink
          href={MEMBERSHIP_PAGE_HREF}
          className="bg-purple-deep flex h-11 flex-none items-center justify-center rounded-[10px] px-5 font-bold text-white"
        >
          {isMember ? t("section.memberCta") : t("section.guestCta")}
        </LocalizedClientLink>
      </div>

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
