import { CustomButton } from "@components/common/custom-buttons/custom-button"
import { WishlistItemWithProduct } from "@lib/services/users/wishlist-with-products"

interface WishCardProps {
  item: WishlistItemWithProduct
  onRemove: (wishlistId: string) => void
  isLoading?: boolean
}

/**
 * WishCard - 찜한 상품 카드 (반응형)
 *
 * 책임:
 * 📡 서버: 가격, 재고, 상태 정보 제공
 * 💻 프론트: 할인율 계산, 품절 판단, 포맷팅
 *
 * 반응형: 모바일 디자인 픽셀 퍼펙트 매칭
 */
export const WishCard = ({
  item,
  onRemove,
  isLoading = false,
}: WishCardProps) => {
  const { product } = item

  // ===== 프론트 계산 (최소 로직) =====

  // 1. 품절 여부 (status 기반)
  const isOutOfStock = product.status !== "active"

  // 2. 할인율 계산 (단순 수식 - 프론트 책임)
  const basePrice = product.basePrice || 0
  const membershipPrice = product.membershipPrice || 0
  const discountRate =
    basePrice > 0 && membershipPrice > 0 && membershipPrice < basePrice
      ? Math.round(((basePrice - membershipPrice) / basePrice) * 100)
      : 0

  // 3. 표시할 가격
  const displayPrice = membershipPrice > 0 ? membershipPrice : basePrice

  // 4. 재고 알림 (5개 미만)
  const showStockAlert = product.stock?.available && product.stock.available < 5

  const handleRemove = () => {
    onRemove(item.id)
  }

  return (
    <article className="flex gap-[15px] border-b border-[#d9d9d9] bg-white px-2.5 py-[15px] lg:gap-3.5 lg:border-gray-200 lg:px-0 lg:py-5">
      {/* 상품 이미지 */}
      <figure className="shrink-0">
        <img
          className="h-[66px] w-[65px] rounded-[1px] object-cover lg:h-32 lg:w-32 lg:rounded-sm"
          src={
            product.thumbnail ||
            product.thumbnails?.[0] ||
            "https://placehold.co/130x130"
          }
          alt={product.name}
        />
      </figure>

      {/* 상품 정보 - container */}
      <div className="flex flex-1 flex-col gap-[11px] lg:gap-2.5">
        {/* 상품명 */}
        <h3 className="line-clamp-2 text-sm text-black lg:text-base lg:text-gray-900">
          {product.name}
        </h3>

        {/* 가격 정보 */}
        <div className="flex flex-col gap-[3px] lg:gap-0 lg:space-y-2">
          {/* 할인 정보 */}
          {discountRate > 0 && (
            <div className="flex items-center gap-1.5">
              <span
                className={`rounded-[3px] px-[3px] py-0.5 text-xs font-medium text-white lg:px-[5px] ${
                  isOutOfStock
                    ? "bg-[#D9D9D9]"
                    : "bg-[#e08f00] lg:bg-yellow-600"
                }`}
              >
                {discountRate}% 할인
              </span>
              <span
                className={`text-[11px] font-medium lg:text-sm ${
                  isOutOfStock
                    ? "text-[#D9D9D9]"
                    : "text-[#ffa500] lg:text-amber-500"
                }`}
              >
                멤버십할인
              </span>
              <span className="lg: text-xs text-[#D9D9D9] line-through lg:text-sm">
                {basePrice.toLocaleString()}원
              </span>
            </div>
          )}

          {/* 판매가 */}
          <strong
            className={`block text-sm leading-none font-bold tracking-tight lg:text-lg ${
              isOutOfStock ? "text-gray-400" : "text-[#1e1e1e] lg:text-gray-900"
            }`}
          >
            {displayPrice.toLocaleString()}원
          </strong>

          {/* 품절 정보 (고정값) */}
          {isOutOfStock && (
            <div className="mt-2 flex items-center gap-2 md:mt-0">
              <span className="text-base leading-none font-bold lg:text-lg">
                일시품절
              </span>
              <span className="text-[11px] leading-none font-normal text-blue-500 lg:text-sm">
                재입고 일정 : 2025.06.15 입고예정
              </span>
            </div>
          )}

          {/* 재고 알림 (5개 미만) */}
          {!isOutOfStock && showStockAlert && (
            <p className="text-[11px] leading-none font-medium text-[#757575] lg:text-xs lg:text-gray-600">
              잔여수량 : {product.stock?.available}개
            </p>
          )}
        </div>

        {/* 액션 버튼 - container */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleRemove}
            disabled={isLoading}
            className="rounded-[3px] border border-[#757575] px-2.5 py-1.5 text-xs leading-none text-black transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 lg:border-gray-300"
          >
            {isLoading ? "처리중..." : "삭제"}
          </button>
          {!isOutOfStock && (
            <CustomButton variant="outline" size="sm">
              장바구니 담기
            </CustomButton>
          )}
        </div>
      </div>
    </article>
  )
}
