import { REVIEWS_OUTBOX_CONFIG } from '../reviews-outbox.config';

/**
 * 같은 리뷰의 적립·취소 명령이 «적재 순서대로» 나가야 한다. 끄면 적립이 백오프 중일 때 취소가
 * 먼저 발행되고, wallet 은 되돌릴 적립을 못 찾아 warn 만 남긴다 — 원장은 REVOKED 인데 잔액엔
 * 적립이 남는 조용한 금전 불일치다.
 *
 * 디스패처 동작 자체는 `libs/events` 의 통합 스펙이 이미 고정한다. 여기서 지키는 것은
 * **ugc 가 그 선택을 «했다»** 는 사실이다 — 설정 한 줄이 지워지면 증상이 아주 늦게 나타난다.
 */
describe('ugc 아웃박스는 리뷰 단위 순서를 보장한다', () => {
  it('strictPartitionOrdering 이 켜져 있다', () => {
    expect(REVIEWS_OUTBOX_CONFIG.strictPartitionOrdering).toBe(true);
  });
});
