"use client"

import { useState, useEffect } from "react"
import { calculateProductPrice, getProductPriceSet } from "@lib/services/pim/products/getPriceService"

/**
 * 상품 가격 실시간 계산 훅
 * 
 * 사용 예시:
 * ```tsx
 * const { price, totalPrice, loading, breakdown } = useProductPrice({
 *   masterId,
 *   variantId: selectedVariant?.id,
 *   quantity,
 *   isMembership: user?.isMember,
 * })
 * ```
 */
export function useProductPrice({
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
    const [price, setPrice] = useState(0)
    const [totalPrice, setTotalPrice] = useState(0)
    const [breakdown, setBreakdown] = useState<{
        basePrice: number
        membershipDiscount?: number
        tieredDiscount?: number
    } | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!variantId) {
            setPrice(0)
            setTotalPrice(0)
            setBreakdown(null)
            return
        }

        const fetchPrice = async () => {
            setLoading(true)
            setError(null)

            try {
                const result = await calculateProductPrice(
                    masterId,
                    variantId,
                    quantity,
                    isMembership
                )

                if (result.error) {
                    setError(result.error)
                    setPrice(0)
                    setTotalPrice(0)
                    setBreakdown(null)
                } else {
                    setPrice(result.price)
                    setTotalPrice(result.totalPrice)
                    setBreakdown(result.breakdown || null)
                }
            } catch (err) {
                setError("가격을 불러올 수 없습니다.")
                setPrice(0)
                setTotalPrice(0)
                setBreakdown(null)
            } finally {
                setLoading(false)
            }
        }

        fetchPrice()
    }, [masterId, variantId, quantity, isMembership])

    return {
        price,
        totalPrice,
        breakdown,
        loading,
        error,
    }
}

/**
 * 상품 가격 세트 조회 훅 (기본가/멤버십가/수량별 가격)
 * 
 * 사용 예시:
 * ```tsx
 * const { basePrice, membershipPrice, discountRate, tieredPrices } = useProductPriceSet({
 *   masterId,
 *   variantId: selectedVariant?.id,
 * })
 * ```
 */
export function useProductPriceSet({
    masterId,
    variantId,
}: {
    masterId: string
    variantId?: string
}) {
    const [basePrice, setBasePrice] = useState(0)
    const [membershipPrice, setMembershipPrice] = useState<number | undefined>(undefined)
    const [tieredPrices, setTieredPrices] = useState<
        Array<{ minQuantity: number; price: number }> | undefined
    >(undefined)
    const [discountRate, setDiscountRate] = useState<number | undefined>(undefined)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!variantId) {
            setBasePrice(0)
            setMembershipPrice(undefined)
            setTieredPrices(undefined)
            setDiscountRate(undefined)
            return
        }

        const fetchPriceSet = async () => {
            setLoading(true)
            setError(null)

            try {
                const result = await getProductPriceSet(masterId, variantId)

                if (result.error) {
                    setError(result.error)
                    setBasePrice(0)
                    setMembershipPrice(undefined)
                    setTieredPrices(undefined)
                    setDiscountRate(undefined)
                } else {
                    setBasePrice(result.basePrice)
                    setMembershipPrice(result.membershipPrice)
                    setTieredPrices(result.tieredPrices)
                    setDiscountRate(result.discountRate)
                }
            } catch (err) {
                setError("가격 정보를 불러올 수 없습니다.")
                setBasePrice(0)
                setMembershipPrice(undefined)
                setTieredPrices(undefined)
                setDiscountRate(undefined)
            } finally {
                setLoading(false)
            }
        }

        fetchPriceSet()
    }, [masterId, variantId])

    return {
        basePrice,
        membershipPrice,
        tieredPrices,
        discountRate,
        loading,
        error,
    }
}


