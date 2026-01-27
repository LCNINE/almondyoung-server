import { ProductCardProps } from "@/lib/types/ui/product"
import { ProductPrice } from "./product-price"
import { ProductRating } from "./product-rating"

export function ProductInfo({
  title,
  price,
  originalPrice,
  discount,
  rating,
  reviewCount,
  membershipSavings,
  showMembershipHint,
}: Omit<ProductCardProps, "imageSrc" | "rank">) {
  const showMembershipBadge = membershipSavings != null

  return (
    <div className="flex flex-col gap-0.5 px-1">
      <h3 className="line-clamp-2 text-[14px] leading-tight text-gray-600">
        {title}
      </h3>

      <div className="mt-1 flex flex-col">
        <ProductPrice
          price={price}
          originalPrice={originalPrice}
          discount={discount}
          membershipSavings={membershipSavings}
          showMembershipHint={showMembershipHint}
          showMembershipBadge={showMembershipBadge}
        />
      </div>

      {/* 리뷰 영역 */}
      <ProductRating rating={rating} reviewCount={reviewCount ?? 0} />
    </div>
  )
}
