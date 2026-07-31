import { RatingSkeleton } from "@/components/skeletons/product-detail-skeletons"
import { Customer } from "@/lib/types/ui/medusa"
import { useTranslations } from "next-intl"
import { Suspense } from "react"
import { RatingActionsWrapper } from "../../templates/product-actions-wrappers/rating-actions-wrapper"
import { WishlistChatActionsWrapper } from "../../templates/product-actions-wrappers/wishlist-chat-actions-wrapper"
import { WishlistButton } from "../actions/wishlist-button"
import { OverseasBadge } from "@/components/shared/badges/overseas-badge"

interface Props {
  brand: string
  productName: string
  productId: string
  pimMasterId: string
  countryCode: string
  customer: Customer | null
  isDigital?: boolean
  isOverseas?: boolean
  /**
   * 상품명을 h1 으로 그릴지. 이 컴포넌트는 모바일/데스크톱 레이아웃에서 각각
   * 한 번씩 렌더되므로 둘 다 h1 이면 문서에 h1 이 두 개가 된다. 모바일 쪽이
   * DOM 순서상 먼저이고 구글이 모바일 우선 색인이라 그쪽만 h1 으로 둔다.
   */
  isPrimaryHeading?: boolean
  children?: React.ReactNode
}

// 상품명, 브랜드, 찜하기 버튼, 리뷰 평점 등을 보여주는 컴포넌트
export function ProductSummary({
  brand,
  productName,
  productId,
  pimMasterId,
  countryCode,
  customer,
  isDigital = false,
  isOverseas = false,
  isPrimaryHeading = false,
  children,
}: Props) {
  const t = useTranslations("productDetail")
  const TitleTag = isPrimaryHeading ? "h1" : "h2"
  return (
    <div className="bg-background">
      <header className="flex justify-between gap-4">
        <div className="mb-4">
          <p className="text-sm text-gray-600">{brand}</p>

          <div className="flex items-center gap-2">
            <TitleTag className="text-xl font-bold">
              {isOverseas && <OverseasBadge className="text-[12px]" />}
              {productName}
            </TitleTag>
            {isDigital && (
              <span className="bg-primary/90 shrink-0 rounded px-2 py-0.5 text-[11px] font-medium text-white">
                {t("digitalBadge")}
              </span>
            )}
          </div>
        </div>

        <div className="flex gap-2">
          <Suspense
            fallback={
              <>
                <WishlistButton
                  productId={productId}
                  isWishlisted={false}
                  countryCode={countryCode}
                />
              </>
            }
          >
            <WishlistChatActionsWrapper
              productId={productId}
              countryCode={countryCode}
              customer={customer}
            />
          </Suspense>
        </div>
      </header>

      <Suspense fallback={<RatingSkeleton />}>
        <RatingActionsWrapper productId={pimMasterId} />
      </Suspense>

      {children}
    </div>
  )
}
