import { formatPrice } from "@/lib/utils/format-price"
import { StoreCart, StoreCartLineItem } from "@medusajs/types"
import Image from "next/image"

interface OrderProductsSectionProps {
  products: StoreCart["items"]
  shippingTotal?: number
}

export const OrderProductsSection = ({
  products,
  shippingTotal = 2500,
}: OrderProductsSectionProps) => {
  console.log("products:", products)
  if (!products || products.length === 0) {
    return (
      <section aria-labelledby="order-heading" className="mb-8">
        <h2
          id="order-heading"
          className="mb-3 text-base font-bold text-gray-900 md:text-xl"
        >
          주문 상품
        </h2>
        <article className="rounded-md border border-gray-200 bg-white p-4 md:rounded-[10px] md:p-10">
          <p className="text-center text-gray-500">주문 상품이 없습니다.</p>
        </article>
      </section>
    )
  }

  return (
    <section aria-labelledby="order-heading" className="mb-8">
      <h2
        id="order-heading"
        className="mb-3 text-base font-bold text-gray-900 md:text-xl"
      >
        주문 상품
      </h2>
      <article className="rounded-md border border-gray-200 bg-white px-[14px] py-[18px] md:rounded-[10px] md:px-10 md:py-8">
        <div className="space-y-4">
          {products.map((item, index) => (
            <ProductItem
              key={item.id}
              item={item}
              showDivider={index < products.length - 1}
            />
          ))}
        </div>

        <p className="mt-4 text-right text-[12px] text-gray-600 md:mt-6 md:text-sm">
          배송비 {formatPrice(shippingTotal)}원
        </p>
      </article>
    </section>
  )
}

function ProductItem({
  item,
  showDivider,
}: {
  item: StoreCartLineItem
  showDivider: boolean
}) {
  const thumbnail = item.thumbnail ?? "/images/product-placeholder.png"
  const productTitle = item.product_title ?? item.title
  const optionLabel = item.variant_title ?? item.subtitle ?? "기본"
  const quantity = item.quantity
  const originalPrice = item.compare_at_unit_price ?? item.original_total
  const salePrice = item.total ?? item.unit_price * quantity
  const hasDiscount = originalPrice && originalPrice > salePrice

  console.log("thumbnail:", thumbnail)

  return (
    <div className={showDivider ? "border-b border-gray-100 pb-4" : ""}>
      <div className="flex items-start gap-3 md:gap-4">
        <Image
          src={thumbnail}
          alt={productTitle}
          width={64}
          height={64}
          className="h-[52px] w-[52px] rounded-[2px] object-cover md:h-[64px] md:w-[64px] md:rounded-[5px]"
        />
        <p className="flex-1 text-[12px] text-gray-900 md:text-sm">
          {productTitle}
        </p>
      </div>

      <div className="mt-3">
        <div className="flex items-start justify-between rounded-[2px] bg-[#F5F5F5]/50 px-2 py-[7px] md:px-3 md:py-2.5">
          <div className="flex items-center gap-2 md:gap-3">
            <span className="rounded-[2px] border border-gray-200 bg-white px-[2px] py-0.5 text-[11px] font-medium text-gray-600">
              옵션
            </span>
            <span className="text-[12px] text-gray-600 md:text-sm">
              {optionLabel} | {quantity}개
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-right">
            {hasDiscount && (
              <span className="text-[12px] text-gray-400 line-through md:text-sm">
                {formatPrice(originalPrice)}
              </span>
            )}
            <span className="text-[13px] text-gray-900 md:text-base">
              {formatPrice(salePrice)}원
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
