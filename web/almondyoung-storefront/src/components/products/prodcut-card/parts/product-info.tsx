import { ProductCardProps } from "@/lib/types/ui/product"
import { ProductMembershipBadge } from "./product-membership-badge"
import { ProductPrice } from "./product-price"
import { ProductRating } from "./product-rating"

export function ProductInfo({
  title,
  price,
  originalPrice,
  discount,
  rating,
  reviewCount,
}: Omit<ProductCardProps, "imageSrc" | "rank">) {
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
        />

        {/* 배지/태그 영역 */}
        <div className="flex items-center gap-1">
          <ProductMembershipBadge size="md" />
        </div>
      </div>

      {/* 리뷰 영역 */}
      <ProductRating rating={rating} reviewCount={reviewCount ?? 0} />
    </div>
  )
}
