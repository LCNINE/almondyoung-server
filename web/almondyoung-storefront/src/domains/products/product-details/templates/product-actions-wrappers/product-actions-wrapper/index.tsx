import { listProducts } from "@/lib/api/medusa/products"
import { Customer } from "@/lib/types/ui/medusa"
import { HttpTypes } from "@medusajs/types"
import ProductActions from "../../../components/product-actions"

export default async function ProductActionsWrapper({
  handle,
  region,
  customer,
}: {
  handle: string
  region: HttpTypes.StoreRegion
  customer: Customer | null
}) {
  // handle 로 조회해야 `product-{handle}` 캐시 태그가 붙는다 (listProducts 의 toProductHandleTags).
  // id 로 조회하면 방문자별 태그만 남아 /api/revalidate 가 영영 못 깨고, 재고를 고쳐도 이 CTA 는
  // TTL(1시간) 만료까지 품절인 채로 남는다
  const product = await listProducts({
    queryParams: { handle },
    regionId: region.id,
  }).then(({ response }) => response.products[0])

  if (!product) {
    return null
  }

  return (
    <ProductActions product={product} region={region} customer={customer} />
  )
}
