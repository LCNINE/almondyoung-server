import { HttpTypes } from "@medusajs/types"
import { Suspense } from "react"
import { RatingActionsWrapper } from "../../templates/product-actions-wrappers/rating-actions-wrapper"
import { WishlistChatActionsWrapper } from "../../templates/product-actions-wrappers/wishlist-chat-actions-wrapper"
import { WishlistButton } from "../actions/wishlist-button"
import { RatingSkeleton } from "@/components/skeletons/product-detail-skeletons"

interface Props {
  brand: string
  productName: string
  productId: string
  countryCode: string
  handle: string
}

export function SideBar({
  brand,
  productName,
  productId,
  countryCode,
  handle,
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
        <RatingActionsWrapper handle={handle} />
      </Suspense>
    </div>
  )
}
