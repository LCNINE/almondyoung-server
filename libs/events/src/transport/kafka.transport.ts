/**
 * Kafka Transport Adapter (프로덕션)
 *
 * `StreamPublisher.sendMessage` 와 `DLQHandler.sendToDLQ` 에 흩어져 있던
 * `ClientKafka` 배선을 그대로 옮긴 것이다. **동작 변경 없음** — 압축 여부까지
 * 호출부가 지정하던 그대로 유지한다.
 */

import { ClientKafka } from '@nestjs/microservices';
import { CompressionTypes } from 'kafkajs';
import { firstValueFrom } from 'rxjs';
import { EventTransport, TransportMessage } from './transport.port';

export class KafkaTransport implements EventTransport {
  constructor(private readonly client: ClientKafka) {}

  async send(topic: string, message: TransportMessage): Promise<void> {
    await firstValueFrom(
      this.client.emit(topic, {
        key: message.key,
        value: message.value,
        ...(message.compress ? { compression: CompressionTypes.GZIP } : {}),
        ...(message.partition !== undefined ? { partition: message.partition } : {}),
        headers: message.headers,
      }),
    );
  }
}
