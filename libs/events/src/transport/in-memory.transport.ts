/**
 * In-Memory Transport Adapter (테스트 전용)
 *
 * `EventTransport` 의 두 번째 구현. 어댑터가 하나뿐인 seam 은 간접층일 뿐이라는
 * ADR-0029 §7 의 요구를 이것이 충족한다.
 */

import { EventTransport, TransportMessage } from './transport.port';
import { InMemoryBroker } from './in-memory.broker';

export class InMemoryTransport implements EventTransport {
  constructor(private readonly broker: InMemoryBroker) {}

  async send(topic: string, message: TransportMessage): Promise<void> {
    // compress 는 의도적으로 무시한다 — 압축은 Kafka 어댑터의 관심사이고,
    // 인메모리 경로에서 관찰 대상은 압축 여부가 아니라 envelope 내용이다.
    await this.broker.publish(topic, {
      key: message.key,
      value: message.value,
      headers: message.headers,
      partition: message.partition,
    });
  }
}
