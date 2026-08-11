import "server-only"
import { cache } from "react"
import { retrieveCustomer } from "@lib/api/medusa/customer"
import { isMembershipGroup } from "@lib/utils/membership-group"
import { getAuthHeaders } from "./cookies"
import { buildCatalogRequest, type CatalogRequestShape } from "./catalog-segment"

/**
 * 카탈로그 조회에 실을 헤더와 캐시 가능 여부를 정한다.
 * 같은 렌더 안에서 목록 조회가 여러 번 일어나도 고객 조회는 한 번만 나간다.
 */
export const buildCatalogRequestForVisitor = cache(
  async (): Promise<CatalogRequestShape> => {
    const authHeaders = await getAuthHeaders()
    const secret = process.env.CATALOG_SEGMENT_SECRET

    if (!authHeaders) {
      return buildCatalogRequest(null, false, secret)
    }

    // 토큰이 있는데 고객 조회가 비면 멤버십 여부를 알 수 없는 상태다. 이때 비회원으로
    // 넘기면 회원에게 비회원가가 보인다. 판정이 안 되면 토큰을 그대로 실어 Medusa 가
    // 정하게 하고 캐시하지 않는다.
    const customer = await retrieveCustomer().catch(() => null)
    if (!customer) {
      return buildCatalogRequest(authHeaders, false, undefined)
    }

    return buildCatalogRequest(
      authHeaders,
      isMembershipGroup(customer.groups),
      secret
    )
  }
)
