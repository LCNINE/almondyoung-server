import { Logger } from '@nestjs/common';
import { Kafka, type ITopicConfig } from 'kafkajs';
import type { KafkaConfig, StreamConfig } from '@packages/event-contracts/types';
import { getDLQTopicName } from '@packages/event-contracts/types';

export interface TopicBootstrapOptions {
  kafka: KafkaConfig;
  streams: StreamConfig[];
  includeDLQ?: boolean;
  numPartitions?: number;
}

/**
 * MSK Serverless처럼 auto-create가 비활성화된 환경에서, EventsModule 초기화 시점에
 * 각 서비스가 선언한 stream 토픽을 Kafka admin으로 멱등 생성한다.
 * `KAFKA_BOOTSTRAP_TOPICS=false`로 비활성화 가능.
 *
 * async useFactory로 provider resolution 시점에 완료된다 —
 * consumer subscribe가 시작되기 전에 토픽이 존재함을 보장.
 */
export async function bootstrapKafkaTopics(options: TopicBootstrapOptions): Promise<void> {
  const logger = new Logger('TopicBootstrap');

  if (process.env.KAFKA_BOOTSTRAP_TOPICS === 'false') {
    logger.log('Topic bootstrap disabled (KAFKA_BOOTSTRAP_TOPICS=false)');
    return;
  }

  const defaultPartitions = options.numPartitions ?? 3;
  const topicMap = new Map<string, number>();
  for (const stream of options.streams) {
    const partitions = stream.topic.partitions ?? defaultPartitions;
    topicMap.set(stream.topic.topic, partitions);
    if (options.includeDLQ ?? true) {
      topicMap.set(getDLQTopicName(stream.topic.topic), partitions);
    }
  }
  if (topicMap.size === 0) return;

  const topics: ITopicConfig[] = [...topicMap.entries()].map(([topic, numPartitions]) => ({
    topic,
    numPartitions,
    // replicationFactor 미지정 → broker default 사용 (MSK Serverless는 자동 관리).
  }));

  const kafka = new Kafka({
    clientId: `${options.kafka.clientId}-bootstrap`,
    brokers: options.kafka.brokers,
    ssl: options.kafka.ssl,
    sasl: options.kafka.sasl,
    retry: options.kafka.retry,
  });
  const admin = kafka.admin();

  logger.log(`Connecting admin to bootstrap ${topicMap.size} topic(s)...`);
  try {
    await admin.connect();
    const created = await admin.createTopics({ topics, waitForLeaders: true });
    if (created) {
      logger.log(`Created Kafka topics: ${[...topicMap.keys()].join(', ')}`);
    } else {
      logger.log(`Kafka topics already exist: ${[...topicMap.keys()].join(', ')}`);
    }
  } catch (err) {
    logger.error(`Failed to bootstrap Kafka topics: ${(err as Error).message}`, (err as Error).stack);
    // 부트스트랩 실패는 앱 크래시를 유발하지 않는다.
  } finally {
    await admin.disconnect().catch(() => undefined);
  }
}

/**
 * 기존 심볼 호환을 위한 토큰.
 */
export const TOPIC_BOOTSTRAP_TOKEN = 'TOPIC_BOOTSTRAP';
