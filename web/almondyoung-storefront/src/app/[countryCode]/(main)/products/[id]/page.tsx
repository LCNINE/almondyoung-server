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
import { getProductPrice } from "@lib/utils/get-product-price"

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

const mapMedusaProductToDetail = (
  product: StoreProduct,
  descriptionHtml?: string
): ProductDetail => {
  const thumbnail =
    product.thumbnail ||
    product.images?.[0]?.url ||
    ""

  const thumbnails =
    product.images?.map((image) => image.url).filter(Boolean) ||
    (thumbnail ? [thumbnail] : [])

  const priceInfo = getProductPrice({ product })
  const basePrice = priceInfo?.cheapestPrice?.original_price_number
  const membershipPrice = priceInfo?.cheapestPrice?.calculated_price_number

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

    try {
      const metadata = medusaProduct?.metadata as
        | Record<string, unknown>
        | undefined
      const pimMasterId =
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
      ? mapMedusaProductToDetail(medusaProduct, pimDescriptionHtml)
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
