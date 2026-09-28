/** 값 목록은 core `apps/core/src/modules/catalog/core/shop-listings/shop-listing.constants.ts` 에서 옮겼다. */
export const SHOP_LISTING_REGIONS = [
  'seoul',
  'gyeonggi',
  'incheon',
  'busan',
  'daegu',
  'gwangju',
  'daejeon',
  'ulsan',
  'sejong',
  'gangwon',
  'chungbuk',
  'chungnam',
  'jeonbuk',
  'jeonnam',
  'gyeongbuk',
  'gyeongnam',
  'jeju',
] as const;
export type ShopListingRegion = (typeof SHOP_LISTING_REGIONS)[number];

export const SHOP_LISTING_BUSINESS_TYPES = [
  'nail',
  'lash',
  'semi-permanent',
  'skincare',
  'hair',
  'waxing',
  'tattoo',
  'etc',
] as const;
export type ShopListingBusinessType = (typeof SHOP_LISTING_BUSINESS_TYPES)[number];

/** transfer = 양도(권리금 받고 넘김), lease = 임대(자리만 빌려줌) */
export const SHOP_LISTING_DEAL_TYPES = ['transfer', 'lease'] as const;
export type ShopListingDealType = (typeof SHOP_LISTING_DEAL_TYPES)[number];

/**
 * 한 축으로 둔다 — 검토 상태·거래 상태·노출 여부를 따로 두면 조합이 폭발한다.
 * 전이 규칙은 `shop-listing.transitions.ts` 가 정본이다.
 */
export const SHOP_LISTING_STATUSES = ['pending', 'published', 'rejected', 'hidden', 'closed'] as const;
export type ShopListingStatus = (typeof SHOP_LISTING_STATUSES)[number];

/** 공개 API 가 노출하는 상태. closed 는 「거래완료」 배지로 남는다. */
export const PUBLIC_SHOP_LISTING_STATUSES = ['published', 'closed'] as const satisfies readonly ShopListingStatus[];

export const SHOP_LISTING_AUTHOR_TYPES = ['admin', 'member'] as const;
export type ShopListingAuthorType = (typeof SHOP_LISTING_AUTHOR_TYPES)[number];

export const SHOP_LISTING_MODERATION_DECIDERS = ['admin', 'classifier'] as const;
export const SHOP_LISTING_MODERATION_DECISIONS = ['approved', 'rejected', 'pending', 'hidden', 'unhidden'] as const;
export type ShopListingModerationDecision = (typeof SHOP_LISTING_MODERATION_DECISIONS)[number];

/** 회원당 pending + published 합계 상한. */
export const MEMBER_ACTIVE_LISTING_LIMIT = 3;
export const MAX_SHOP_LISTING_IMAGES = 15;
export const MAX_SHOP_LISTING_CONTENT_LENGTH = 10_000;

/** 동시 게시 한도 검사를 직렬화하는 advisory lock 의 클래스 키. 다른 락과 겹치지 않게 두 인자 형식을 쓴다. */
export const SHOP_LISTING_ADVISORY_LOCK_CLASS = 7301;

// 한글 완성형은 코드포인트로 escape 한다 — 리터럴로 쓰면 겉보기 같은 CJK 문자가 섞인다.
const HANGUL = '\\uAC00-\\uD7A3';
export const SHOP_LISTING_SLUG_PATTERN = new RegExp(`^[a-z0-9${HANGUL}]+(?:-[a-z0-9${HANGUL}]+)*$`);
