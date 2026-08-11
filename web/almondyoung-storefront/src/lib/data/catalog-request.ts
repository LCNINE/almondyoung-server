import "server-only"
import { cache } from "react"
import { getAuthHeaders } from "./cookies"
import { getIsMembershipCustomer } from "./membership"
import { buildCatalogRequest, type CatalogRequestShape } from "./catalog-segment"

/**
 * 카탈로그 조회에 실을 헤더와 캐시 가능 여부를 정한다.
 * 같은 렌더 안에서 목록 조회가 여러 번 일어나도 고객 조회는 한 번만 나간다.
 */
export const buildCatalogRequestForVisitor = cache(
  async (): Promise<CatalogRequestShape> => {
    const authHeaders = await getAuthHeaders()

    if (!authHeaders) {
      return buildCatalogRequest(null, false, process.env.CATALOG_SEGMENT_SECRET)
    }

    return buildCatalogRequest(
      authHeaders,
      await getIsMembershipCustomer(),
      process.env.CATALOG_SEGMENT_SECRET
    )
  }
)
