/**
 * 외부 마켓플레이스(네이버·쿠팡) 판별.
 *
 * 이 채널들은 비로그인 주문이라 구매자 식별(`customerId`)이 없어 디지털 소유권을 부여할 수
 * 없다. 그래서 디지털 상품은 자사몰(medusa)에서만 판다.
 *
 * `ChannelListingService`(생성·재활성 가드)와 `ProductVersionsService`(publish 후 리스팅
 * 승계, #652)가 같은 규칙을 봐야 해서 모듈 밖으로 뺐다 — 두 모듈이 서로를 import 하면
 * 순환이 생긴다.
 */
export function isExternalMarketplaceSite(site: string): boolean {
  return site === 'naver' || site === 'coupang';
}
