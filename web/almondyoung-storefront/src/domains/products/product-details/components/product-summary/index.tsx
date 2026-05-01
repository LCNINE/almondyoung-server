import { RatingSkeleton } from "@/components/skeletons/product-detail-skeletons"
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
  children?: React.ReactNode
}

export function ProductSummary({
  brand,
  productName,
  productId,
  pimMasterId,
  countryCode,
  children,
}: Props) {
  return (
    <div className="bg-background">
      <header className="flex justify-between gap-4">
        <div className="mb-4">
          <p className="text-sm text-gray-600">{brand}</p>

          <h2 className="text-xl font-bold">{productName}</h2>
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
