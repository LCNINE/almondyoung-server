import "server-only"
import { retrieveCustomer } from "@lib/api/medusa/customer"
import { isMembershipGroup } from "@lib/utils/membership-group"
import { cache } from "react"

/**
 * 현재 방문자가 멤버십 회원인지. 비로그인/일반 회원은 모두 false.
 * 같은 렌더 안에서 여러 번 물어봐도 고객 조회는 한 번만 나가게 캐시한다.
 */
export const getIsMembershipCustomer = cache(async (): Promise<boolean> => {
  const customer = await retrieveCustomer().catch(() => null)
  return isMembershipGroup(customer?.groups)
})
