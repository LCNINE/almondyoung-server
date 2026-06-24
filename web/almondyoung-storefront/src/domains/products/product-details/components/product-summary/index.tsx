import { RatingSkeleton } from "@/components/skeletons/product-detail-skeletons"
import { Customer } from "@/lib/types/ui/medusa"
import { useTranslations } from "next-intl"
import { Suspense } from "react"
import { RatingActionsWrapper } from "../../templates/product-actions-wrappers/rating-actions-wrapper"
import { WishlistChatActionsWrapper } from "../../templates/product-actions-wrappers/wishlist-chat-actions-wrapper"
import { WishlistButton } from "../actions/wishlist-button"

interface Props {
  brand: string
  productName: string
  productId: string
  pimMasterId: string
  countryCode: string
  customer: Customer | null
  isDigital?: boolean
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
  children,
}: Props) {
  const t = useTranslations("productDetail")
  return (
    <div className="bg-background">
      <header className="flex justify-between gap-4">
        <div className="mb-4">
          <p className="text-sm text-gray-600">{brand}</p>

          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold">{productName}</h2>
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
