import "server-only"
import { cache } from "react"
import { retrieveCustomer } from "@lib/api/medusa/customer"
import { isMembershipGroup } from "@lib/utils/membership-group"
import { getAuthHeaders, getCacheTag } from "./cookies"

const hashToken = (token: string): string => {
  let h = 5381
  for (let i = 0; i < token.length; i++) {
    h = (h * 33) ^ token.charCodeAt(i)
  }
  return (h >>> 0).toString(36)
}

/**
 * 멤버십 가입/해지는 `_medusa_jwt` 를 바꾸지 않는다. 토큰 해시만으로 버킷을 나누면
 * 해지 후에도 멤버십 가격이 담긴 응답을 `revalidate: 3600` 만료까지 계속 서빙한다.
 * 목록 태그는 방문자별이라 백엔드에서 무효화할 수단이 없으므로, 멤버십 여부를
 * 세그먼트에 넣어 상태가 바뀌는 순간 다른 버킷을 읽게 하는 것이 유일한 수단이다.
 *
 * 같은 렌더 안에서 목록 조회가 여러 번 일어나도 고객 조회는 한 번만 나가게 캐시한다.
 */
const getMembershipSegment = cache(async (): Promise<string> => {
  const customer = await retrieveCustomer().catch(() => null)
  return isMembershipGroup(customer?.groups) ? "mem" : "reg"
})

/**
 * 멤버십/로그인 상태에 따라 응답이 달라지는 목록(상품 등)용 캐시 태그.
 *
 * 기본 방문자별 태그(`${tag}-${_medusa_cache_id}`)에 인증 주체와 멤버십 세그먼트를
 * 덧붙여, 회원/비회원 그리고 서로 다른 계정이 같은 캐시 버킷을 공유하지 않게 한다.
 */
export const getMembershipAwareCacheTags = async (
  tag: string
): Promise<string[]> => {
  const base = await getCacheTag(tag)
  if (!base) {
    return []
  }

  const auth = await getAuthHeaders()
  const token = auth?.authorization?.replace(/^Bearer\s+/i, "")
  if (!token) {
    return [`${base}-anon`]
  }

  return [`${base}-m${hashToken(token)}-${await getMembershipSegment()}`]
}
