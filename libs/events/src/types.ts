// 기본 이벤트 페이로드 인터페이스
export interface BaseEventPayload {
  timestamp: string;
  correlationId: string;
  source: string;
}

// 이벤트 정의 타입
export interface EventDefinition<TPayload = any> {
  topic: string;
  payload: TPayload;
}

// 이벤트 패턴 타입
export type EventPattern<T extends Record<string, EventDefinition>> = {
  [K in keyof T]: T[K]['topic'];
}[keyof T];

// 특정 이벤트의 페이로드 타입 추출
export type EventPayload<
  T extends Record<string, EventDefinition>,
  K extends keyof T,
> = T[K]['payload'];

// Kafka 설정 인터페이스
export interface KafkaConfig {
  clientId: string;
  brokers: string[];
  groupId?: string;
  ssl?: boolean;
  sasl?: import('kafkajs').SASLOptions;
  retry?: {
    retries?: number;
    initialRetryTime?: number;
  };
}

// 환경 변수 기반 Kafka 설정
export interface KafkaEnvironmentConfig {
  KAFKA_CLIENT_ID: string;
  KAFKA_BROKERS: string;
  KAFKA_GROUP_ID?: string;
  KAFKA_API_KEY?: string;
  KAFKA_API_SECRET?: string;
}

// 환경 변수를 KafkaConfig로 변환하는 헬퍼
export function createKafkaConfigFromEnv(
  env: KafkaEnvironmentConfig,
): KafkaConfig {
  const config: KafkaConfig = {
    clientId: env.KAFKA_CLIENT_ID,
    brokers: env.KAFKA_BROKERS.split(','),
    groupId: env.KAFKA_GROUP_ID,
    retry: {
      retries: 5,
      initialRetryTime: 300,
    },
  };

  // Confluent Cloud 설정 (API Key/Secret이 있으면 SSL/SASL 활성화)
  if (env.KAFKA_API_KEY && env.KAFKA_API_SECRET) {
    config.ssl = true;
    config.sasl = {
      mechanism: 'plain',
      username: env.KAFKA_API_KEY,
      password: env.KAFKA_API_SECRET,
    } as import('kafkajs').SASLOptions;
  }

  return config;
}
