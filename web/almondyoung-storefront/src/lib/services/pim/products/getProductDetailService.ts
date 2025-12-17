// services/pim/products/getProductDetailService.ts
// PIM 상세 + (선택) 카테고리 경로/WMS 재고/유저 메타 주입
// 컴포넌트는 ProductDetail만 의존하도록 보장

import { getProductDetail } from "@lib/api/pim/masters.server"
import { toProductDetail } from "@lib/utils/transformers"
import type {
  ProductDetail,
  ProductDetailServiceOpts,
} from "@lib/types/ui/product"

// descriptionHtml에서 이미지 URL 추출하는 유틸 함수
const extractAllImgs = (html?: string | null): string[] => {
  if (!html) return []
  const matches: string[] = []
  let match
  const regex = /<img[^>]+src=["']([^"']+)["']/gi
  while ((match = regex.exec(html)) !== null) {
    let imageUrl = match[1]
    // 상대 경로인 경우 절대 경로로 변환
    if (imageUrl.startsWith('/')) {
      imageUrl = `https://almondyoung.com${imageUrl}`
    }
    matches.push(imageUrl)
  }
  return matches
}
// import { getSkuStockByProduct } from "@lib/api/wms/wms-api" // 필요 시
// import { getUserProductMeta } from "@lib/services/user/user-product-meta.service" // 필요 시

export async function getProductDetailService(
  id: string,
  opts?: ProductDetailServiceOpts
): Promise<ProductDetail> {
  // 1) PIM 상세
  const result = await getProductDetail(id)
  if ("error" in result) {
    throw new Error(result.error.message)
  }
  const dto = result.data
  let productDetail = toProductDetail(dto)

  // 2) descriptionHtml에서 detailImages 추출
  const detailImages = extractAllImgs(dto.descriptionHtml)
  productDetail = {
    ...productDetail,
    detailImages
  }

  // 3) (선택) 부가 데이터 병렬 처리 준비
  const promises: Array<Promise<unknown>> = []


  // 3-2) WMS 재고 (TODO: 실제 WMS 연동 시 교체)
  const skuStockPromise = opts?.withStock
    ? Promise.resolve({} as Record<string, number>)
    : Promise.resolve({} as Record<string, number>)
  promises.push(skuStockPromise)

  // 3-3) 유저 메타
  // const userMetaPromise = opts?.userId
  //   ? getUserProductMeta({ userId: opts.userId, productId: id }).catch(() => undefined)
  //   : Promise.resolve(undefined)
  // promises.push(userMetaPromise)


  // 4) (선택) 결과 주입
  const [skuStock] = await Promise.all(promises) as [Record<string, number>]

  if (skuStock) {
    productDetail = { ...productDetail, skuStock }
    const total = Object.values(skuStock).reduce((a, b) => a + (b || 0), 0)
    // isSoldOut은 ProductDetail 타입에 없으므로 제거
  }

  // if (userMeta) {
  //   product = { ...product, userMeta }
  // }
  return productDetail
}
