import {
  LISTING_RESOLUTION_CAUSES,
  toListingResolutionCause,
} from './listing-resolution-cause';

/**
 * 어휘의 정본은 여기 하나다 (#674). Core 가 내고 channel-adapter 가 영속하며 화면이 렌더하므로,
 * 양쪽에 재정의하면 한쪽만 값이 늘었을 때 조용히 틀린다.
 *
 * 배포는 Core 가 먼저라, **어댑터는 자기가 모르는 값을 만날 수 있다.** 그때 타입이 거짓말하게
 * 두는 것보다 `unknown` 으로 낮춰 저장하는 편이 낫다 — 화면도 "판정 불가" 로 일관되게 읽는다.
 */
describe('ListingResolutionCause 어휘', () => {
  it('9종을 모두 가진다', () => {
    expect([...LISTING_RESOLUTION_CAUSES].sort()).toEqual(
      [
        'channel_inactive',
        'listing_inactive',
        'listing_not_found',
        'no_active_version',
        'no_embedded_ids',
        'no_lookup_key',
        'product_deleted',
        'unknown',
        'variant_inactive',
      ].sort(),
    );
  });

  it('알려진 값은 그대로 통과시킨다', () => {
    expect(toListingResolutionCause('variant_inactive')).toBe('variant_inactive');
  });

  it('모르는 값은 unknown 으로 낮춘다', () => {
    expect(toListingResolutionCause('listing_haunted')).toBe('unknown');
  });

  it('문자열이 아닌 값도 unknown 으로 낮춘다', () => {
    expect(toListingResolutionCause(null)).toBe('unknown');
    expect(toListingResolutionCause(undefined)).toBe('unknown');
    expect(toListingResolutionCause(42)).toBe('unknown');
  });
});
