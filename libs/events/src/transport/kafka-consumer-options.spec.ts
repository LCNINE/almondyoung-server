/**
 * 컨슈머 커밋 정책 (#1073)
 *
 * 커밋이 꺼져 있던 동안 라이브 9개 그룹 전 파티션의 커밋 오프셋이 없었고(`events_consumer_lag`
 * 전부 -1), kafkajs 는 리밸런스마다 브로커에 오프셋을 다시 물어 없으면 최신으로 점프했다 —
 * 배포 때마다 죽은 멤버가 쥐던 파티션의 메시지가 조용히 사라졌다. 커밋은 «켜는 옵션»이 아니라
 * 고정값이어야 한다: 끌 수 있으면 언젠가 누가 끈다.
 */
import { buildKafkaConsumerServerOptions, KAFKA_CONSUMER_GROUP_POSTFIX } from './kafka-consumer-options';

const kafka = { clientId: 'spec', brokers: ['localhost:9092'] };

describe('buildKafkaConsumerServerOptions', () => {
  it('처리를 마친 메시지의 오프셋을 커밋한다', () => {
    const options = buildKafkaConsumerServerOptions(kafka, { groupId: 'g' });

    expect(options.run).toMatchObject({ autoCommit: true });
  });

  it('커밋을 끄는 입력 자리가 없다', () => {
    // 타입 수준 고정: autoCommit 을 넘기면 컴파일이 깨져야 한다.
    // @ts-expect-error autoCommit 은 KafkaConsumerTuning 에 없다
    buildKafkaConsumerServerOptions(kafka, { groupId: 'g', autoCommit: false });
  });

  it('커밋 오프셋이 없을 때만 최신에서 시작한다 — 처음부터 다시 읽지 않는다', () => {
    const options = buildKafkaConsumerServerOptions(kafka, { groupId: 'g' });

    expect(options.subscribe).toEqual({ fromBeginning: false });
  });

  it('그룹 이름 접미사를 lag 폴러와 같은 상수로 명시한다', () => {
    const options = buildKafkaConsumerServerOptions(kafka, { groupId: 'g' });

    expect(options.postfixId).toBe(KAFKA_CONSUMER_GROUP_POSTFIX);
    expect(options.consumer).toMatchObject({ groupId: 'g', allowAutoTopicCreation: false });
  });

  it('타이밍 기본값을 유지한다', () => {
    const options = buildKafkaConsumerServerOptions(kafka, { groupId: 'g' });

    expect(options.consumer).toMatchObject({
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
      maxPollInterval: 300000,
    });
  });
});
