import { mutate } from "swr"
import { getProductsByCategoryService} from "@lib/services/pim/products/getProductListService"

export async function prefetchCategoryProducts(categoryId: string, limit = 50, sort: "popular" | "new" | "price" = "popular") {
  const key = ["category-products", categoryId, sort, limit] as const
  // mutate에 프로미스를 넣으면 해당 결과를 캐시에 채움(화면에선 아직 사용 안 해도 캐시가 준비)
  return mutate(key, getProductsByCategoryService(categoryId, { page: 1, limit, sort }), { revalidate: false })
}