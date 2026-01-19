import { fetchMe } from "@lib/api/users/me"
import { getWishlistByProductId } from "@lib/api/users/wishlist"
import { getProductDetail } from "@lib/api/medusa/products"
import { getRegion } from "@lib/api/medusa/regions"
import { getProductDetailByMasterId } from "@lib/api/pim/products"
import { ProductDetail } from "@lib/types/ui/product"
import type { UserDetail, WishlistItem } from "@lib/types/ui/user"
import ProductDetailPage from "domains/products/product-details/product-detail-page"
import { Suspense } from "react"
import type { StoreProduct } from "@medusajs/types"
import { getPricesForVariant, getProductPrice } from "@lib/utils/get-product-price"

const mapProductMetadata = (metadata?: Record<string, unknown>) => {
  if (!metadata) return undefined

  return Object.entries(metadata).reduce<Record<string, string>>(
    (acc, [key, value]) => {
      if (value == null) return acc
      acc[key] = typeof value === "string" ? value : String(value)
      return acc
    },
    {}
  )
}

const buildSelectionKey = (
  selection: Record<string, string>,
  optionOrder: string[]
) => {
  if (optionOrder.length === 0) return undefined

  const parts = optionOrder.map((label) => {
    const value = selection[label]
    return value ? `${label}=${value}` : ""
  })

  if (parts.some((part) => !part)) return undefined

  return parts.join("|")
}

const mapMedusaProductToDetail = (
  product: StoreProduct,
  descriptionHtml?: string,
  pimMasterId?: string
): ProductDetail => {
  const thumbnail =
    product.thumbnail ||
    product.images?.[0]?.url ||
    ""

  const thumbnails =
    product.images?.map((image) => image.url).filter(Boolean) ||
    (thumbnail ? [thumbnail] : [])

  const defaultVariant =
    product.variants?.find(
      (variant: any) => variant?.is_default || variant?.isDefault
    ) || product.variants?.[0]
  const defaultVariantId = defaultVariant?.id
  const defaultPrice = defaultVariant
    ? getPricesForVariant(defaultVariant)
    : null
  const priceInfo = getProductPrice({ product })
  const basePrice =
    defaultPrice?.original_price_number ||
    priceInfo?.cheapestPrice?.original_price_number
  const membershipPrice =
    defaultPrice?.calculated_price_number ||
    priceInfo?.cheapestPrice?.calculated_price_number

  const options =
    product.options?.map((option) => ({
      type: option.title,
      label: option.title,
      values:
        option.values?.map((value) => ({
          id: value.id,
          name: value.value,
        })) || [],
    })) || []

  const optionOrder = product.options?.map((option) => option.title) || []
  const optionLabelById = new Map(
    product.options?.map((option) => [option.id, option.title]) || []
  )
  const skuIndex: Record<string, string> = {}
  const variantPriceMap: Record<
    string,
    { basePrice?: number; membershipPrice?: number }
  > = {}
  const variantThumbnailMap: Record<string, string> = {}

  for (const variant of product.variants || []) {
    const variantPrice = getPricesForVariant(variant)
    if (variant.id) {
      variantPriceMap[variant.id] = {
        basePrice: variantPrice?.original_price_number,
        membershipPrice: variantPrice?.calculated_price_number,
      }
      variantThumbnailMap[variant.id] =
        variant?.images?.[0]?.url || thumbnail
    }

    const selection: Record<string, string> = {}
    for (const opt of variant.options || []) {
      const optionId = opt.option_id ?? undefined
      const label =
        (optionId ? optionLabelById.get(optionId) : undefined) ||
        optionId ||
        ""
      if (label && opt.value) {
        selection[label] = opt.value
      }
    }

    const selectionKey = buildSelectionKey(selection, optionOrder)
    if (selectionKey && variant.id) {
      skuIndex[selectionKey] = variant.id
    }
  }

  const metadata = product.metadata as Record<string, unknown> | undefined
  const brand =
    (typeof metadata?.brand === "string" && metadata.brand) ||
    product.subtitle ||
    undefined

  return {
    id: product.id,
    name: product.title,
    thumbnail,
    thumbnails,
    description: product.description || undefined,
    descriptionHtml: descriptionHtml || undefined,
    brand,
    status: product.status
      ? product.status === "published"
        ? "active"
        : "inactive"
      : "active",
    basePrice,
    membershipPrice,
    isMembershipOnly: false,
    options,
    optionMeta: { isSingle: options.length === 0 },
    tags: product.tags?.map((tag) => tag.value) || undefined,
    productInfo: mapProductMetadata(metadata),
    detailImages: thumbnails.slice(1),
    defaultVariantId,
    variantPriceMap,
    variantThumbnailMap,
    skuIndex: Object.keys(skuIndex).length > 0 ? skuIndex : undefined,
    pimMasterId,
  }
}

export default async function Page({
  params,
}: {
  params: Promise<{ id: string; countryCode: string }>
}) {
  const { id, countryCode } = await params
  let product: ProductDetail | null = null
  let error: string | null = null
  const user: UserDetail | null = await fetchMe().catch(() => null)
  const wishlist: WishlistItem | null = await getWishlistByProductId(id)
  const region = await getRegion(countryCode)

  try {
    const medusaProduct = await getProductDetail(id, region?.id)
    let pimDescriptionHtml: string | undefined
    let pimMasterId: string | undefined

    try {
      const metadata = medusaProduct?.metadata as
        | Record<string, unknown>
        | undefined
      pimMasterId =
        (typeof metadata?.pimMasterId === "string" && metadata.pimMasterId) ||
        medusaProduct?.handle ||
        undefined

      if (pimMasterId) {
        const pimDetail = await getProductDetailByMasterId(pimMasterId)
        pimDescriptionHtml = pimDetail?.descriptionHtml ?? undefined
      }
    } catch (pimError) {
      console.error("상품 상세 HTML 로드 실패:", pimError)
    }

    product = medusaProduct
      ? mapMedusaProductToDetail(medusaProduct, pimDescriptionHtml, pimMasterId)
      : null
  } catch (err) {
    console.error("상품 상세 정보 로드 실패:", err)
    error =
      err instanceof Error ? err.message : "상품 정보를 불러올 수 없습니다."
  }

  return (
    <div className="md:bg-muted/50 min-h-screen bg-white">
      <Suspense fallback={<div className="p-8">로딩 중…</div>}>
        <ProductDetailPage
          params={Promise.resolve({ id, countryCode })}
          product={product}
          wishlist={wishlist}
          error={error}
          user={user}
        />
      </Suspense>
    </div>
  )
}
