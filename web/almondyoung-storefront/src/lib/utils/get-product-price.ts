import { HttpTypes } from "@medusajs/types"
import { getPercentageDiff } from "./get-precentage-diff"
import { convertToLocale } from "./price-utils"

const getCalculatedAmount = (variant: any) => {
  // calculated_price_incl_tax가 있으면 사용
  if (typeof variant?.calculated_price_incl_tax === "number") {
    return variant.calculated_price_incl_tax
  }

  // calculated_price가 객체인 경우 calculated_amount 사용
  const cp = variant?.calculated_price
  if (typeof cp === "object" && cp !== null) {
    return cp.calculated_amount ?? null
  }

  // calculated_price가 숫자인 경우 직접 사용
  if (typeof cp === "number") {
    return cp
  }

  return null
}

const getOriginalAmount = (variant: any) => {
  // original_price_incl_tax가 있으면 사용
  if (typeof variant?.original_price_incl_tax === "number") {
    return variant.original_price_incl_tax
  }

  // original_price가 숫자인 경우 직접 사용
  if (typeof variant?.original_price === "number") {
    return variant.original_price
  }

  // calculated_price 객체에서 original_amount 사용
  const cp = variant?.calculated_price
  if (typeof cp === "object" && cp !== null) {
    return cp.original_amount ?? null
  }

  return null
}

const getCurrencyCode = (variant: any) => {
  return (
    variant?.currency_code ?? variant?.calculated_price?.currency_code ?? "krw"
  )
}

const getPriceType = (variant: any) => {
  return (
    variant?.price_type ??
    variant?.calculated_price?.calculated_price?.price_list_type
  )
}

export const getPricesForVariant = (variant: any) => {
  let calculatedAmount = getCalculatedAmount(variant)

  if (calculatedAmount == null && variant?.prices?.length > 0) {
    const firstPrice = variant.prices[0]
    calculatedAmount = firstPrice?.amount ?? null
  }

  if (calculatedAmount == null) {
    return null
  }

  const originalAmount = getOriginalAmount(variant)
  const currencyCode = getCurrencyCode(variant)

  return {
    calculated_price_number: calculatedAmount,
    calculated_price: convertToLocale({
      amount: calculatedAmount,
      currency_code: currencyCode,
    }),
    original_price_number: originalAmount ?? calculatedAmount,
    original_price: convertToLocale({
      amount: originalAmount ?? calculatedAmount,
      currency_code: currencyCode,
    }),
    currency_code: currencyCode,
    price_type: getPriceType(variant),
    percentage_diff: getPercentageDiff(
      originalAmount ?? calculatedAmount,
      calculatedAmount
    ),
  }
}

export function getProductPrice({
  product,
  variantId,
}: {
  product: HttpTypes.StoreProduct
  variantId?: string
}) {
  if (!product || !product.id) {
    throw new Error("No product provided")
  }

  const cheapestPrice = () => {
    if (!product || !product.variants?.length) {
      return null
    }

    const cheapestVariant: any = product.variants
      .filter((v: any) => !!v.calculated_price)
      .sort((a: any, b: any) => {
        return (
          a.calculated_price.calculated_amount -
          b.calculated_price.calculated_amount
        )
      })[0]

    return getPricesForVariant(cheapestVariant)
  }

  const variantPrice = () => {
    if (!product || !variantId) {
      return null
    }

    const variant: any = product.variants?.find(
      (v) => v.id === variantId || v.sku === variantId
    )

    if (!variant) {
      return null
    }

    return getPricesForVariant(variant)
  }

  return {
    product,
    cheapestPrice: cheapestPrice(),
    variantPrice: variantPrice(),
  }
}
