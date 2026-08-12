import "server-only"
import { cache } from "react"
import { retrieveCustomer } from "@lib/api/medusa/customer"
import { isMembershipGroup } from "@lib/utils/membership-group"
import { getAuthHeaders } from "./cookies"
import type { CatalogVisitorState } from "./catalog-segment"

export type CatalogVisitor = {
  state: CatalogVisitorState
  /** `unknown` 폴백과 개인화 조회에 쓸 토큰. 비로그인이면 null. */
  authHeaders: { authorization: string } | null
}

/**
 * 현재 방문자의 멤버십 판정을 3상태로 돌려준다.
 *
 * 토큰이 있는데 고객 조회가 비면 멤버십 여부를 알 수 없는 상태다. 이때 비회원으로 접으면
 * 회원에게 비회원가가 나가므로 `unknown` 을 그대로 돌려주고, 캐시 경로가 알아서
 * 개인 토큰으로 떨어지게 한다.
 *
 * 같은 렌더 안에서 목록 조회가 여러 번 일어나도 고객 조회는 한 번만 나간다.
 */
export const resolveCatalogVisitor = cache(async (): Promise<CatalogVisitor> => {
  const authHeaders = await getAuthHeaders()

  if (!authHeaders) {
    return { state: "reg", authHeaders: null }
  }

  const customer = await retrieveCustomer().catch(() => null)
  if (!customer) {
    return { state: "unknown", authHeaders }
  }

  return {
    state: isMembershipGroup(customer.groups) ? "mem" : "reg",
    authHeaders,
  }
})
