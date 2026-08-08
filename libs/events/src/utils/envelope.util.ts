/**
 * Kafka 메시지 value → MessageEnvelope
 *
 * **Nest 는 수신 메시지의 `value` 를 그대로 넘기지 않는다.** `KafkaParser.decode` 가
 * `keepBinary` 기본값(false)에서 JSON 을 파싱해 넘기므로, 운영에서
 * `KafkaContext.getMessage().value` 는 Buffer 가 아니라 **객체**다
 * (`@nestjs/microservices/helpers/kafka-parser.js`, `server-kafka.js:113`).
 *
 * `Buffer.isBuffer(value) ? value.toString() : String(value)` 관용구는 객체가 오면
 * `"[object Object]"` 를 만들고 `JSON.parse` 가 터진다. 이 헬퍼는 세 형태를 모두 받아
 * 그 함정을 한 곳에 가둔다.
 */

import { MessageEnvelope } from '@packages/event-contracts/types';

export function parseEnvelope(value: unknown): MessageEnvelope {
  if (value === null || value === undefined) {
    throw new Error('Kafka message value is null or undefined');
  }

  // as 정당화: JSON.parse 는 unknown 을 반환하고 런타임 스키마 검증은
  // SchemaValidationInterceptor 소관이다. 여기서는 envelope 형태를 신뢰한다.
  if (Buffer.isBuffer(value)) {
    return JSON.parse(value.toString('utf-8')) as MessageEnvelope;
  }
  if (typeof value === 'string') {
    return JSON.parse(value) as MessageEnvelope;
  }
  if (typeof value === 'object') {
    return value as MessageEnvelope;
  }

  throw new Error(`Unsupported Kafka message value type: ${typeof value}`);
}
