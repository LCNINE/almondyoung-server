/**
 * Event Transport Port
 *
 * 이벤트가 이 프로세스 밖으로 나가는 유일한 통로. 운영은 `KafkaTransport`,
 * 테스트는 `InMemoryTransport` 가 구현한다.
 *
 * **소비 방향은 이 port 에 없다.** 소비 루프는 `libs/events` 가 아니라 각 앱
 * `main.ts` 의 `connectMicroservice()` 가 만든 Nest `ServerKafka` 가 소유하므로,
 * `subscribe()` 를 여기 두면 Kafka 쪽에 정직한 구현이 존재할 수 없다. 소비 방향의
 * 다형성은 Nest 의 `CustomTransportStrategy` 확장점에서 얻는다 (ADR-0029 §7).
 */

export interface TransportMessage {
  /** 파티션 키 — 순서 보장 단위 */
  key: string;
  /** 직렬화된 envelope */
  value: string;
  headers?: Record<string, string>;
  /**
   * 대상 파티션 지정. 생략하면 어댑터가 `key` 로 결정한다.
   * (`DLQHandler.reprocessDLQ` 만 명시적으로 쓴다.)
   */
  partition?: number;
  /**
   * 전송 압축 요청. 브로커 중립적인 불리언이며 어댑터가 자기 방식으로 해석한다.
   * (`KafkaTransport` 는 GZIP. 기존 동작 보존용 — `StreamPublisher` 는 압축했고
   * `DLQHandler` 는 압축하지 않았다.)
   */
  compress?: boolean;
}

export interface EventTransport {
  send(topic: string, message: TransportMessage): Promise<void>;
}

/** DI 토큰. `EventsModule` 이 어댑터를 여기에 바인딩한다. */
export const EVENT_TRANSPORT = Symbol('EVENT_TRANSPORT');
