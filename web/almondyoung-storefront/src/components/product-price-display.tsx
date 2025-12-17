"use client"

import { useProductPrice, useProductPriceSet } from "@hooks/use-product-price"
import { formatCurrency } from "@lib/utils/format"

/**
 * 상품 가격 표시 컴포넌트
 * 
 * 옵션 선택 시 실시간으로 가격 계산 및 표시
 * 
 * 사용 예시:
 * ```tsx
 * <ProductPriceDisplay
 *   masterId={product.masterId}
 *   variantId={selectedVariant?.id}
 *   quantity={quantity}
 *   isMembership={user?.isMember}
 * />
 * ```
 */
export function ProductPriceDisplay({
    masterId,
    variantId,
    quantity = 1,
    isMembership = false,
}: {
    masterId: string
    variantId?: string
    quantity?: number
    isMembership?: boolean
}) {
    const { price, totalPrice, breakdown, loading, error } = useProductPrice({
        masterId,
        variantId,
        quantity,
        isMembership,
    })

    if (error) {
        return (
            <div className="text-sm text-red-600">
                {error}
            </div>
        )
    }

    if (loading) {
        return (
            <div className="animate-pulse">
                <div className="h-8 bg-gray-200 rounded w-32" />
            </div>
        )
    }

    if (!variantId || price === 0) {
        return (
            <div className="text-sm text-gray-500">
                옵션을 선택해주세요
            </div>
        )
    }

    return (
        <div className="space-y-2">
            {/* 단가 */}
            <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold">
                    {formatCurrency(price)}
                </span>
                <span className="text-sm text-gray-500">/ 개</span>
            </div>

            {/* 총 가격 (수량 > 1일 때만) */}
            {quantity > 1 && (
                <div className="flex items-baseline gap-2">
                    <span className="text-lg font-semibold text-primary">
                        총 {formatCurrency(totalPrice)}
                    </span>
                    <span className="text-sm text-gray-500">
                        ({quantity}개)
                    </span>
                </div>
            )}

            {/* 할인 정보 */}
            {breakdown && (
                <div className="text-sm text-gray-600 space-y-1">
                    {breakdown.membershipDiscount && breakdown.membershipDiscount > 0 && (
                        <div className="flex items-center gap-2">
                            <span className="text-primary font-medium">멤버십 할인</span>
                            <span className="line-through text-gray-400">
                                {formatCurrency(breakdown.basePrice)}
                            </span>
                            <span className="text-primary">
                                -{formatCurrency(breakdown.membershipDiscount)}
                            </span>
                        </div>
                    )}
                    {breakdown.tieredDiscount && breakdown.tieredDiscount > 0 && (
                        <div className="flex items-center gap-2">
                            <span className="text-green-600 font-medium">수량 할인</span>
                            <span className="text-green-600">
                                -{formatCurrency(breakdown.tieredDiscount * quantity)}
                            </span>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

/**
 * 상품 가격 정보 표시 컴포넌트
 * 
 * 기본가/멤버십가/할인율을 한눈에 표시
 * 
 * 사용 예시:
 * ```tsx
 * <ProductPriceInfo
 *   masterId={product.masterId}
 *   variantId={selectedVariant?.id}
 * />
 * ```
 */
export function ProductPriceInfo({
    masterId,
    variantId,
}: {
    masterId: string
    variantId?: string
}) {
    const { basePrice, membershipPrice, discountRate, tieredPrices, loading, error } =
        useProductPriceSet({
            masterId,
            variantId,
        })

    if (error) {
        return (
            <div className="text-sm text-red-600">
                {error}
            </div>
        )
    }

    if (loading) {
        return (
            <div className="animate-pulse space-y-2">
                <div className="h-6 bg-gray-200 rounded w-24" />
                <div className="h-8 bg-gray-200 rounded w-32" />
            </div>
        )
    }

    if (!variantId || basePrice === 0) {
        return null
    }

    return (
        <div className="space-y-3">
            {/* 기본가 */}
            <div className="flex items-baseline gap-2">
                <span className="text-sm text-gray-500">정가</span>
                <span className={membershipPrice ? "line-through text-gray-400" : "text-xl font-bold"}>
                    {formatCurrency(basePrice)}
                </span>
            </div>

            {/* 멤버십가 */}
            {membershipPrice && (
                <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium text-primary">멤버십가</span>
                    <span className="text-2xl font-bold text-primary">
                        {formatCurrency(membershipPrice)}
                    </span>
                    {discountRate && (
                        <span className="text-sm font-semibold text-red-500 bg-red-50 px-2 py-1 rounded">
                            {discountRate}% 할인
                        </span>
                    )}
                </div>
            )}

            {/* 수량별 할인 */}
            {tieredPrices && tieredPrices.length > 0 && (
                <div className="border-t pt-3">
                    <div className="text-sm font-medium text-gray-700 mb-2">
                        수량별 할인가
                    </div>
                    <div className="space-y-1">
                        {tieredPrices.map((tier) => (
                            <div
                                key={tier.minQuantity}
                                className="flex items-center gap-2 text-sm"
                            >
                                <span className="text-gray-600">
                                    {tier.minQuantity}개 이상
                                </span>
                                <span className="font-semibold text-green-600">
                                    {formatCurrency(tier.price)} / 개
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}


