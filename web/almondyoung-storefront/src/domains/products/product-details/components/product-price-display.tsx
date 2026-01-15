import { AnimatedMembershipText } from "@components/products/atomics/animated-membership-text"
import { MembershipTagIcon } from "@/icons/membership-tag-icon"

type MemberPrice = {
  range: string
  rate: number
  price: number
}

type Props = {
  basePrice: number
  membershipPrice?: number
  isMembershipOnly?: boolean
  discountRate: number
  memberPrices?: MemberPrice[]
}

/**
 * @description 상품 가격 표시 컴포넌트
 * 시맨틱: <output>을 사용하여 계산된 값 표현
 */
export function ProductPriceDisplay({
  basePrice,
  membershipPrice,
  isMembershipOnly,
  discountRate,
  memberPrices,
}: Props) {
  return (
    <section className="mb-6" aria-label="상품 가격">
      {/* 멤버십 태그 */}
      {!isMembershipOnly && discountRate > 0 && (
        <div className="inline-flex max-w-[120px] items-center">
          <MembershipTagIcon />
        </div>
      )}

      {/* 가격 정보 */}
      <output className="mb-4 flex items-baseline gap-2">
        {isMembershipOnly ? (
          /* 멤버십 전용 */
          <>
            <span className="text-gray-400 line-through">
              {basePrice.toLocaleString()}원
            </span>
            <AnimatedMembershipText
              className="text-2xl font-bold"
              delay={800}
              duration={2000}
            />
          </>
        ) : (
          /* 일반 상품 */
          <>
            {discountRate > 0 && (
              <>
                <span className="text-gray-400 line-through">
                  {basePrice.toLocaleString()}원
                </span>
                <span className="text-2xl font-bold text-red-500">
                  {discountRate}%
                </span>
              </>
            )}
            <span className="text-2xl font-bold">
              {(membershipPrice || basePrice).toLocaleString()}원
            </span>
          </>
        )}
      </output>

      {/* 멤버십 등급별 가격 */}
      {memberPrices && memberPrices.length > 0 && (
        <dl className="bg-muted space-y-1.5 p-4">
          {memberPrices.map((price, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between text-sm"
            >
              <dt>{price.range} 구매 시</dt>
              <dd className="flex items-center gap-2">
                <span className="text-red-500">{price.rate}%</span>
                <span className="font-medium">
                  개당 {price.price.toLocaleString()}원
                </span>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}
