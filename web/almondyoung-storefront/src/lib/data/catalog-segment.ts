export const CATALOG_SEGMENT_HEADER = "x-catalog-segment"
export const CATALOG_SEGMENT_KEY_HEADER = "x-catalog-segment-key"

/** Medusa 가 실제로 적용한 세그먼트를 담아 내려주는 응답 필드. */
export const CATALOG_SEGMENT_ECHO_FIELD = "catalog_segment"

/** 공유 캐시에 넣을 수 있는 두 벌. 응답은 (region, 수량, 이 값)의 함수다. */
export type CatalogSegment = "mem" | "reg"

/**
 * 방문자의 멤버십 판정. `unknown` 은 "아직 모른다"를 접지 않고 그대로 들고 있기 위한 상태다.
 *
 * 예전에는 boolean 하나였는데, 그러면 "모름"이 자동으로 `false`(일반회원)로 접혀
 * 회원에게 비회원가가 나갔다. 세 번째 상태를 타입에 남겨 호출부가 각자 처리하게 한다.
 * 호출부마다 틀렸을 때 벌어지는 일이 달라서(카탈로그 캐시는 전원 영향, 뱃지 렌더는 1회)
 * 처리 방식을 하나로 뭉개지 않는다. 카탈로그 캐시 경로의 규칙은
 * "모름 → 개인 토큰 + 캐시 안 함" 이다.
 */
export type CatalogVisitorState = CatalogSegment | "unknown"

/**
 * 스토어프론트가 주장한 세그먼트와 Medusa 가 적용한 세그먼트가 다를 때.
 *
 * 진짜 장애(네트워크·5xx)와 구분하려고 전용 타입을 쓴다. 이 에러는 캐시 콜백 안에서
 * 던져져 응답이 저장되는 걸 막고, 호출부는 개인 토큰 경로로 폴백한다.
 */
export class CatalogSegmentMismatchError extends Error {
  readonly claimed: CatalogSegment
  readonly applied: string | null

  constructor(claimed: CatalogSegment, applied: string | null) {
    super(
      `카탈로그 세그먼트가 적용되지 않았다: 주장 ${claimed}, 적용 ${applied ?? "없음"}`
    )
    this.name = "CatalogSegmentMismatchError"
    this.claimed = claimed
    this.applied = applied
  }
}

export const buildSegmentHeaders = (
  segment: CatalogSegment,
  secret: string
): Record<string, string> => ({
  [CATALOG_SEGMENT_HEADER]: segment,
  [CATALOG_SEGMENT_KEY_HEADER]: secret,
})

/** 응답에 실린 "적용된 세그먼트". 필드가 없거나 모르는 값이면 null. */
export const readAppliedSegment = (body: unknown): CatalogSegment | null => {
  if (typeof body !== "object" || body === null) return null

  const applied = (body as Record<string, unknown>)[CATALOG_SEGMENT_ECHO_FIELD]
  return applied === "mem" || applied === "reg" ? applied : null
}

/**
 * 에코는 주장의 반복이 아니라 적용의 증명이다.
 *
 * Medusa 는 세그먼트를 온전히 적용했을 때만 그 값을 에코한다. 시크릿이 안 맞거나
 * 멤버십 그룹 id 가 비어 가격 그룹을 못 넣은 경우엔 mem 을 에코하지 않으므로,
 * 여기서 걸려 반쪽 응답이 회원 칸에 저장되는 일이 없다.
 */
export const assertSegmentApplied = (
  claimed: CatalogSegment,
  body: unknown
): void => {
  const applied = readAppliedSegment(body)
  if (applied !== claimed) {
    throw new CatalogSegmentMismatchError(claimed, applied)
  }
}
