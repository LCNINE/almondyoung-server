/**
 * In-Memory Broker (테스트 전용)
 *
 * 발행 어댑터(`InMemoryTransport`)와 소비 전략(`InMemoryServer`)이 공유하는 버스.
 * 토픽별 발행 로그를 남겨 테스트가 관찰할 수 있게 하고, 외부 서비스가 보낸 메시지를
 * 흉내내는 `inject()` 를 제공한다.
 */

import { MessageEnvelope } from '@packages/event-contracts/types';

export interface BrokerRecord {
  topic: string;
  partition: number;
  offset: string;
  key: string;
  /** 직렬화된 상태 그대로 — Kafka 가 바이트를 나르는 것과 같다 */
  value: string;
  headers: Record<string, string>;
  timestamp: string;
}

export interface DeliveryFailure {
  record: BrokerRecord;
  error: unknown;
}

type Subscriber = (record: BrokerRecord) => Promise<void>;

export interface InjectOptions {
  key?: string;
  headers?: Record<string, string>;
}

export class InMemoryBroker {
  private readonly records: BrokerRecord[] = [];
  private readonly subscribers = new Set<Subscriber>();
  private readonly nextOffset = new Map<string, number>();
  private readonly failures: DeliveryFailure[] = [];

  /** 소비 전략이 자신을 등록한다. 반환값을 호출하면 해지된다. */
  subscribe(subscriber: Subscriber): () => void {
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  /**
   * 발행 경로 — `InMemoryTransport` 가 부른다.
   *
   * 배달은 **동기**다(구독자 처리를 await 한다). 그래야 테스트가
   * `await publisher.publishEvent(...)` 직후에 바로 단언할 수 있다.
   */
  async publish(
    topic: string,
    message: { key: string; value: string; headers?: Record<string, string>; partition?: number },
  ): Promise<BrokerRecord> {
    const offset = this.nextOffset.get(topic) ?? 0;
    this.nextOffset.set(topic, offset + 1);

    const record: BrokerRecord = {
      topic,
      partition: message.partition ?? 0,
      offset: String(offset),
      key: message.key,
      value: message.value,
      headers: { ...(message.headers ?? {}) },
      timestamp: String(Date.now()),
    };

    // 로그를 먼저 남긴다 — 핸들러가 다시 발행해도 로그 순서가 인과와 일치한다
    this.records.push(record);
    await this.deliver(record);
    return record;
  }

  /**
   * 외부 서비스가 보낸 메시지를 흉내낸다.
   *
   * `StreamPublisher` 를 우회하므로 `validateOnPublish` 를 타지 않는다 —
   * 스키마를 만족하지 않는 인바운드 메시지를 만들 수 있는 유일한 경로이며,
   * 실제로도 그런 메시지는 *다른 서비스가* 보낸다. 문자열을 그대로 넘기면
   * 깨진 JSON 도 주입할 수 있다.
   */
  async inject(topic: string, envelope: unknown, options?: InjectOptions): Promise<BrokerRecord> {
    const value = typeof envelope === 'string' ? envelope : JSON.stringify(envelope);
    return this.publish(topic, {
      key: options?.key ?? 'injected',
      value,
      headers: options?.headers,
    });
  }

  /** 해당 토픽으로 나간(또는 주입된) 메시지 전부 */
  messagesOn(topic: string): BrokerRecord[] {
    return this.records.filter((record) => record.topic === topic);
  }

  /** `messagesOn` 의 envelope 파싱본 */
  envelopesOn<T = MessageEnvelope>(topic: string): T[] {
    return this.messagesOn(topic).map((record) => JSON.parse(record.value) as T);
  }

  /** 발행된 토픽 이름 전부 (중복 없음, 발행 순서) */
  get topics(): string[] {
    return [...new Set(this.records.map((record) => record.topic))];
  }

  /**
   * 소비 중 터진 에러. 발행자에게는 전파되지 않는다 — 운영에서 Kafka 발행은
   * 소비자 실패와 무관하게 성공하므로, 그 분리를 여기서도 지킨다.
   */
  get deliveryFailures(): readonly DeliveryFailure[] {
    return this.failures;
  }

  reset(): void {
    this.records.length = 0;
    this.failures.length = 0;
    this.nextOffset.clear();
  }

  private async deliver(record: BrokerRecord): Promise<void> {
    for (const subscriber of [...this.subscribers]) {
      try {
        await subscriber(record);
      } catch (error) {
        this.failures.push({ record, error });
      }
    }
  }
}
