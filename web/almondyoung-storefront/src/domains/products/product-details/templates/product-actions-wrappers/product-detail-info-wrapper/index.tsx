import { getProductDetailByMasterId } from "@/lib/api/pim/products"
import { HttpTypes } from "@medusajs/types"
import { ProductDetailInfo } from "../../../components/product-detail-info"

interface Props {
  pricedProduct: HttpTypes.StoreProduct
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

export async function ProductDetailInfoWrapper({ pricedProduct }: Props) {
  const pimDetail = await getProductDetailByMasterId(
    pricedProduct?.metadata?.pimMasterId as string
  )

  const detailImages: HttpTypes.StoreProductImage[] = pricedProduct.images ?? [
    {
      id: (pricedProduct.thumbnail ?? "") as string,
      url: pricedProduct.thumbnail ?? "",
      rank: 1,
    },
  ]

  const detailImageUrls: string[] = detailImages.map((img) => img.url)

  return (
    <>
      <ProductDetailInfo
        productInfo={pricedProduct.metadata as ProductInfo}
        descriptionHtml={pimDetail.descriptionHtml ?? undefined}
        detailImages={detailImageUrls}
        productName={pricedProduct.title}
      />
    </>
  )
}
