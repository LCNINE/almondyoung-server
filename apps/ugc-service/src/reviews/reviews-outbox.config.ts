import type { OutboxConfig } from '@app/events';

/**
 * ugc 리뷰 아웃박스 설정. 모듈 «밖»에 두는 것은 `reviews.module.ts` 를 import 하면
 * `EventsModule.forApp` 이 즉시 실행돼 Kafka 설정을 요구하기 때문이다 — 스펙이 이 선택을
 * 읽으려면 부팅 없이 읽을 수 있어야 한다. wallet 의 `wallet-outbox.config.ts` 와 같은 모양이다.
 */
export const REVIEWS_OUTBOX_CONFIG: OutboxConfig = {
  /**
   * 같은 리뷰의 명령은 «적재 순서대로만» 나간다. 끄면(기본) 적립이 한 번 실패해 백오프 중일 때
   * 취소가 먼저 발행되고, wallet 은 되돌릴 적립을 못 찾아 warn 만 남기고 끝낸다
   * (`ugc-command.consumer.ts`) — 그 뒤 적립이 들어가 **원장은 REVOKED 인데 잔액엔 적립이
   * 남는다.** 리뷰를 쓰자마자 지우거나 숨기는 경로가 정확히 그 모양이다.
   *
   * 대가는 head-of-line blocking 이지만 **막히는 단위가 «리뷰 한 건»** 이다 —
   * 파티션 키가 `aggregateId`(=reviewId)로 해석돼 행에 실린다
   * (`stream-publisher.service.ts` 의 `resolvePartitionKey`, 로컬 21행 전수 확인).
   * 한 리뷰의 명령이 재시도를 소진해도 다른 리뷰는 그대로 나간다. wallet 이 같은 선택을
   * 했고 라이브러리로 회수됐다(ADR-0029 §5-1).
   */
  strictPartitionOrdering: true,
};
