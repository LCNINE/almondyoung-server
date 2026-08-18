/**
 * 채널 주문 라인이 우리 판매상품 variant 로 해석되지 않은 이유 (#674).
 *
 * 가르는 기준은 "증상이 다른가" 가 아니라 **"운영자가 할 일이 다른가"** 다.
 *
 * | cause               | 조치                          |
 * |---------------------|-------------------------------|
 * | listing_not_found   | 리스팅을 만든다               |
 * | listing_inactive    | 리스팅을 켠다                 |
 * | channel_inactive    | 판매채널을 켠다               |
 * | variant_inactive    | 품목을 활성화한다             |
 * | no_active_version   | publish 한다                  |
 * | product_deleted     | 다른 상품으로 재매핑한다      |
 * | no_embedded_ids     | Core 를 통해 상품을 다시 만든다 |
 * | no_lookup_key       | 채널 데이터를 확인한다        |
 * | unknown             | 판정 불가 (구 Core 폴백·옛 행) |
 *
 * 전부 **Core 카탈로그 상태**에 대한 말이고 채널 특성이 아니다. 그래서 채널이 열 개가 돼도
 * 이 표는 안 늘어난다 — CONTEXT.md 의 "격리 큐는 채널 능력과 무관하게 하나다" 가 유지된다.
 */
export const LISTING_RESOLUTION_CAUSES = [
  'listing_not_found',
  'listing_inactive',
  'channel_inactive',
  'variant_inactive',
  'no_active_version',
  'product_deleted',
  'no_embedded_ids',
  'no_lookup_key',
  'unknown',
] as const;

export type ListingResolutionCause = (typeof LISTING_RESOLUTION_CAUSES)[number];

/**
 * 바깥에서 들어온 값을 어휘 안으로 좁힌다.
 *
 * 배포 순서가 Core → 어댑터라, 어댑터는 자기가 모르는 값을 받을 수 있다. 그대로 저장하면
 * 타입이 거짓말하고 화면이 렌더할 수 없는 값이 영속된다.
 */
export function toListingResolutionCause(value: unknown): ListingResolutionCause {
  return typeof value === 'string' && (LISTING_RESOLUTION_CAUSES as readonly string[]).includes(value)
    ? (value as ListingResolutionCause)
    : 'unknown';
}

/** 격리된 주문에서 식별에 실패한 라인 하나. */
export interface AffectedLine {
  lineId: string;
  cause: ListingResolutionCause;
}
