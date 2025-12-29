import { fetchMe } from "@lib/api/users/me"
import { getWishlistByProductId } from "@lib/api/users/wishlist"
import { getProductDetailService } from "@lib/services/pim/products/getProductDetailService"
import { ProductDetail } from "@lib/types/ui/product"
import type { UserDetail, WishlistItem } from "@lib/types/ui/user"
import ProductDetailPage from "domains/products/product-details/product-detail-page"
import { Suspense } from "react"

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

  try {
    product = await getProductDetailService(id, {
      userId: user?.id,
      withStock: true,
    })
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
