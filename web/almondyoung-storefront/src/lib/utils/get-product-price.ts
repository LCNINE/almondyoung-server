import { HttpTypes } from "@medusajs/types"
import { getPercentageDiff } from "./get-precentage-diff"
import { convertToLocale } from "./money"

const getCalculatedAmount = (variant: any) => {
  return (
    variant?.calculated_price_incl_tax ??
    variant?.calculated_price ??
    variant?.calculated_price?.calculated_amount ??
    null
  )
}

const getOriginalAmount = (variant: any) => {
  return (
    variant?.original_price_incl_tax ??
    variant?.original_price ??
    variant?.calculated_price?.original_amount ??
    null
  )
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

    const pricedVariants = product.variants
      .map((variant: any) => ({
        variant,
        price: getPricesForVariant(variant),
      }))
      .filter((entry: any) => entry.price)
      .sort(
        (a: any, b: any) =>
          a.price.calculated_price_number - b.price.calculated_price_number
      )

    return pricedVariants[0]?.price || null
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
