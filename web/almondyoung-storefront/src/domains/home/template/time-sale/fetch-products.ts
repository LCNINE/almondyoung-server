import type { HttpTypes } from "@medusajs/types"
import { listProducts } from "@/lib/api/medusa/products"
import { chunk } from "@/lib/utils/time-sale-pagination"

// /store/products 한 번에 받을 id 수. 넘으면 나눠 동시에 부른다.
const IDS_PER_REQUEST = 50

// id 목록의 상품을 /store/products 로 조회한다(멤버십 은닉 미들웨어를 반드시 거친다).
export async function fetchProductsByIds(
  ids: string[],
  regionId: string | undefined
): Promise<HttpTypes.StoreProduct[]> {
  const pages = await Promise.all(
    chunk(ids, IDS_PER_REQUEST).map((part) =>
      listProducts({
        queryParams: { id: part, limit: part.length },
        regionId,
      })
    )
  )

  return pages.flatMap((page) => page.response.products)
}
