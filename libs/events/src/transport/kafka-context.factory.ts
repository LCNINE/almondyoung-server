/**
 * 레코드 → 진짜 `KafkaContext` (#1016 8번 다시 넣기 + `InMemoryServer`).
 *
 * 진짜 `KafkaContext` 여야 하는 이유: `EventRetryInterceptor`·`EventTypeGuard`·`SchemaValidationInterceptor` 가
 * `instanceof KafkaContext` 로 게이트한다. 손으로 만든 객체를 넣으면 재시도·분류·검증이 통째로 건너뛰어진다.
 * `KafkaParser` 를 쓰는 이유: Nest 는 수신 `value` 를 JSON 파싱해서 넘긴다 — 운영과 같은 것을 넘겨야 한다.
 */
import { KafkaContext, KafkaParser, Server } from '@nestjs/microservices';
import { isObservable, lastValueFrom } from 'rxjs';
import type { BrokerRecord } from './in-memory.broker';

const parser = new KafkaParser();

/**
 * `KafkaContext` 가 요구하지만 이 경로에서 의미가 없는 협력자들. 호출되면 조용히 통과하지 않고 즉시 던진다.
 *
 * as 정당화: Nest 의 `Consumer`/`Producer` 타입은 공개 표면에 없고(`external/kafka.interface`), 우리 코드가 실제로 쓰는 것은
 * `getHeartbeat()` 뿐이다.
 */
function unsupportedCollaborator<T>(name: string): T {
  return new Proxy(
    {},
    {
      get(_target, property) {
        throw new Error(
          `KafkaContext.${name}().${String(property)} 는 이 경로(인메모리·다시 넣기)가 제공하지 않는다. ` +
            `이 경로를 검증해야 한다면 실제 브로커가 필요하다.`,
        );
      },
    },
  ) as T;
}

export function buildKafkaContext(
  record: BrokerRecord,
  heartbeat: () => Promise<void>,
): { context: KafkaContext; data: unknown } {
  const rawMessage = parser.parse<Record<string, unknown>>({
    topic: record.topic,
    partition: record.partition,
    key: Buffer.from(record.key),
    value: Buffer.from(record.value),
    headers: Object.fromEntries(Object.entries(record.headers).map(([name, value]) => [name, Buffer.from(value)])),
    timestamp: record.timestamp,
    offset: record.offset,
    size: Buffer.byteLength(record.value),
    attributes: 0,
  });
  const context = new KafkaContext([
    // as 정당화: `parser.parse` 의 반환은 입력 형태를 따르는 제네릭이라 Nest 내부 `KafkaMessage` 로 좁혀지지 않는다.
    rawMessage as never,
    record.partition,
    record.topic,
    unsupportedCollaborator('getConsumer'),
    heartbeat,
    unsupportedCollaborator('getProducer'),
  ]);
  // KafkaRequestDeserializer.mapToSchema 와 동일: value 가 있으면 value, 없으면 메시지 전체
  return { context, data: rawMessage.value ?? rawMessage };
}

/**
 * 서버에 등록된 토픽 핸들러를 한 번 부르고 끝까지 기다린다 — `ServerKafka.handleEvent` 가 `lastValueFrom` 으로 기다리는 것과
 * 같은 의미다(#1073). 같은 토픽의 다중 핸들러는 `handlerRef.next` 로 Nest 가 순회하므로 한 번만 부른다.
 * 처리 시작·끝 훅(`onProcessingStartHook`)은 부르지 않는다 — protected 이고, 기본값은 `done()` 을 그대로 부를 뿐이다.
 */
export async function dispatchToServerHandler(server: Server, record: BrokerRecord): Promise<boolean> {
  const handler = server.getHandlerByPattern(record.topic);
  if (!handler) return false;
  const { context, data } = buildKafkaContext(record, () => Promise.resolve());
  const resultOrStream: unknown = await handler(data, context);
  if (isObservable(resultOrStream)) {
    await lastValueFrom(resultOrStream, { defaultValue: undefined });
  }
  return true;
}
