export const CATALOG_SEGMENT_HEADER = "x-catalog-segment"
export const CATALOG_SEGMENT_KEY_HEADER = "x-catalog-segment-key"

export type CatalogSegment = "mem" | "reg"

export type CatalogRequestShape = {
  headers: Record<string, string>
  /** 공유 캐시에 넣으면 안 되는 요청인지. 세그먼트로 전환되면 false 가 된다. */
  isPersonalized: boolean
}

/**
 * 카탈로그 조회를 개인 토큰 대신 세그먼트로 보낸다.
 *
 * 응답은 (region, 수량, 멤버십 여부)의 함수라 회원/비회원 두 벌이면 전부 표현된다.
 * 개인 토큰을 실으면 fetch 캐시 키가 회원 수만큼 쪼개져 캐시가 무의미해진다.
 *
 * 시크릿이 없으면 세그먼트를 신뢰시킬 수 없으므로 토큰을 그대로 쓰고 캐시하지 않는다.
 */
export const buildCatalogRequest = (
  authHeaders: { authorization: string } | null,
  isMember: boolean,
  segmentSecret: string | undefined
): CatalogRequestShape => {
  // 멤버십 회원이 아니면 로그인 여부와 무관하게 응답이 같다. 헤더를 비워 비로그인과
  // 같은 캐시 항목을 쓰게 한다.
  if (!authHeaders || !isMember) {
    return { headers: {}, isPersonalized: false }
  }

  if (!segmentSecret) {
    return { headers: { ...authHeaders }, isPersonalized: true }
  }

  return {
    headers: {
      [CATALOG_SEGMENT_HEADER]: "mem",
      [CATALOG_SEGMENT_KEY_HEADER]: segmentSecret,
    },
    isPersonalized: false,
  }
}
