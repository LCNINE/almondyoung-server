import { withImageAlt } from "@/lib/seo/detail-image-alt"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import { HttpTypes } from "@medusajs/types"
import { getTranslations } from "next-intl/server"
import type { ProductDetail } from "@/lib/types/ui/pim"
import { ProductDetailInfo } from "../../../components/product-detail-info"

interface Props {
  pricedProduct: HttpTypes.StoreProduct
  /** page 에서 await 해 내려준 PIM 상세. 조회 실패(또는 pimMasterId 없음)면 null */
  pimDetail: ProductDetail | null
}

export type ProductInfo = {
  productNumber?: string
  weight?: string
  dimensions?: string
  origin?: string
  capacity?: string
  expirationDate?: string
  manufacturer?: string
  brand?: string
  material?: string
  usage?: string
  [key: string]: string | undefined
}

export async function ProductDetailInfoWrapper({
  pricedProduct,
  pimDetail,
}: Props) {
  // 종전엔 여기서 PIM 을 fetch 하다 실패하면 ErrorBoundary 폴백이 떴다.
  // 지금은 page 가 실패를 null 로 넘기므로 같은 문구를 직접 렌더한다.
  if (!pimDetail) {
    const t = await getTranslations("productDetail.section")
    return <div>{t("loadDetailFail")}</div>
  }

  const detailImages: HttpTypes.StoreProductImage[] = pricedProduct.images ?? [
    {
      id: (pricedProduct.thumbnail ?? "") as string,
      url: pricedProduct.thumbnail ?? "",
      rank: 1,
    },
  ]

  const detailImageUrls: string[] = detailImages
    .map((img) => getThumbnailUrl(img.url))
    .filter(Boolean)

  const tInfo = await getTranslations("productDetail.info")
  const descriptionHtml = pimDetail.descriptionHtml
    ? withImageAlt(pimDetail.descriptionHtml, (index) =>
        tInfo("detailImageAlt", { name: pricedProduct.title, index })
      )
    : undefined

  return (
    <ProductDetailInfo
      productInfo={pricedProduct.metadata as ProductInfo}
      description={pimDetail.description ?? undefined}
      descriptionHtml={descriptionHtml}
      detailImages={detailImageUrls}
      productName={pricedProduct.title}
    />
  )
}
