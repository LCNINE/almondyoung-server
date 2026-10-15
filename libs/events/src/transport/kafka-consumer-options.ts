import type { KafkaOptions } from '@nestjs/microservices';
import type { KafkaConfig } from '@packages/event-contracts/types';

/**
 * Nest `ServerKafka` 가 `consumer.groupId` 뒤에 붙이는 접미사 (`server-kafka.js:31`, `postfixId`
 * 기본값). 브로커에 실재하는 그룹 이름은 `<groupId>-server` 다 — `startConsumer` 가 이 상수를
 * `postfixId` 로 **명시**하고 lag 폴러(#815)도 같은 상수로 그룹 이름을 만든다. Nest 의 기본값이
 * 바뀌어도 두 쪽이 갈라지지 않는다. 값은 지금 라이브 그룹 이름과 같다.
 *
 * 상수가 이 파일에 있는 것은 `events.module.ts` 가 이 파일을 import 해도 순환이 생기지 않게 하기
 * 위해서다. `events.module.ts` 가 다시 내보내 공개 이름은 그대로다.
 */
export const KAFKA_CONSUMER_GROUP_POSTFIX = '-server';

/** 앱이 고를 수 있는 컨슈머 설정. 커밋 정책은 여기 없다 — 아래 `run` 주석 참조. */
export interface KafkaConsumerTuning {
  groupId: string;
  sessionTimeout?: number; // ms (기본: 30000)
  heartbeatInterval?: number; // ms (기본: 3000)
  maxPollInterval?: number; // ms (기본: 300000)
}

/**
 * `startConsumer` 가 Nest `ServerKafka` 에 넘기는 옵션 (#1073).
 *
 * subscribe.topics 를 만들지 않는다 — `ServerKafka.bindEvents()` 가 등록된 `@On` 패턴으로
 * 어차피 덮어쓴다(`server-kafka.js:92`). 만들어 두면 "이 목록이 구독을 결정한다"는 틀린
 * 모델이 다시 자란다 (ADR-0029 §2).
 */
export function buildKafkaConsumerServerOptions(
  kafka: KafkaConfig,
  consumer: KafkaConsumerTuning,
): NonNullable<KafkaOptions['options']> {
  // maxPollInterval 은 kafkajs 의 ConsumerConfig 타입에 없어 객체 리터럴에 바로 쓰면 컴파일이 깨진다.
  // 예전에는 옵션이 `unknown` 으로 넘어가 가려져 있었다. 동작(값이 그대로 넘어간다)을 바꾸지 않으려고
  // 변수로 한 번 거쳐 넘긴다 — 이 값이 브로커 쪽에서 실제로 쓰이는지는 이 변경의 범위 밖이다.
  const consumerConfig = {
    groupId: consumer.groupId,
    sessionTimeout: consumer.sessionTimeout || 30000,
    heartbeatInterval: consumer.heartbeatInterval || 3000,
    maxPollInterval: consumer.maxPollInterval || 300000,
    allowAutoTopicCreation: false,
  };

  return {
    postfixId: KAFKA_CONSUMER_GROUP_POSTFIX,
    client: {
      clientId: kafka.clientId,
      brokers: kafka.brokers,
      ssl: kafka.ssl,
      sasl: kafka.sasl,
      retry: kafka.retry,
    },
    consumer: consumerConfig,
    // 커밋 오프셋이 없을 때만 쓰인다. 커밋이 켜진 뒤로는 그룹이 처음 생길 때 한 번뿐이다.
    subscribe: { fromBeginning: false },
    // 커밋은 끌 수 없다. `ServerKafka.handleEvent` 가 핸들러 Observable 을 `lastValueFrom` 으로
    // 기다리므로(`server-kafka.js:225-236`) kafkajs 는 `eachMessage` 가 끝난 메시지만 resolve 하고,
    // 배치가 끝날 때, 5초마다, 100건마다(`autoCommitOffsetsIfNecessary`), eachMessage 가 던질 때(그 전까지
    // 처리한 오프셋), 멈출 때 그 오프셋을 커밋한다. 크래시 뒤 다시 오는 창은 5초, 100건,
    // 배치의 남은 부분 중 가장 작은 쪽이다. 핸들러가 던지면 그 메시지는 resolve 되지 않아 재시작 뒤 다시 온다. 꺼져 있던 동안에는 리밸런스마다 최신으로 점프해 메시지를 잃었다.
    run: {
      autoCommit: true,
      autoCommitInterval: 5000,
      autoCommitThreshold: 100,
    },
  };
}
