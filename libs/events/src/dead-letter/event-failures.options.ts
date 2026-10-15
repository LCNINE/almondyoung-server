/** `EventFailuresModule.forRoot` 가 제공하는 설정의 토큰 */
export const EVENT_FAILURES_OPTIONS = Symbol('EVENT_FAILURES_OPTIONS');

export interface EventFailuresOptions {
  /**
   * 순서를 지키는 토픽 (#1016 7·8번 최종 리뷰 B, 스펙 D8 «같은 주문»). 이 토픽의 메시지만 같은 순서 키(`aggregateId`)의
   * 앞 실패 뒤에 보류되고, 다시 넣기·목록도 순서 단위로 묶인다.
   *
   * 목록에 없는 토픽의 실패도 `failed` 로 **기록은 된다** — 보류만 없고, 그 행은 키가 없는 행처럼 혼자 한 순서다.
   * 전부 켜지 않는 이유: `ProductSellableQuantityChanged` 같은 «마지막 값이 이긴다» 스트림은 한 번 실패한 메시지가 더 새
   * 값을 몇 시간씩 붙잡아 Medusa·마켓에 낡은 재고가 남는다. 주문 생애 토픽만 순서가 의미 있다.
   *
   * 토픽 이름 문자열 대신 스트림 상수(`X_STREAM.topic.topic`)로 적는다.
   */
  sequencedTopics: readonly string[];
}
