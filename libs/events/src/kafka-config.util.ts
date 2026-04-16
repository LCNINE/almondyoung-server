import { generateAuthToken } from 'aws-msk-iam-sasl-signer-js';
import * as os from 'os';
import type { KafkaConfig } from '@packages/event-contracts/types';

/**
 * 환경변수에서 KafkaConfig를 생성하는 공용 유틸리티.
 *
 * 인증 방식 자동 분기:
 *   1. KAFKA_SASL_MECHANISM=aws-iam  → oauthbearer + MSK IAM Signer (태스크 롤)
 *   2. KAFKA_API_KEY + KAFKA_API_SECRET → SASL PLAIN (Confluent Cloud)
 *   3. 둘 다 없음 → plaintext (로컬 개발)
 *
 * @returns KafkaConfig | null (KAFKA_BROKERS 미설정 시 null)
 */
export function createKafkaConfigFromEnv(): KafkaConfig | null {
  const brokersRaw = process.env.KAFKA_BROKERS;
  if (!brokersRaw) {
    console.warn('⚠️  KAFKA_BROKERS가 설정되지 않아 Kafka를 사용하지 않습니다.');
    return null;
  }

  const brokers = brokersRaw.split(',').map((b) => b.trim());
  const prefix = process.env.KAFKA_CLIENT_ID_PREFIX || process.env.SERVICE_NAME || 'unknown';

  const config: KafkaConfig = {
    clientId: `${prefix}_${os.hostname()}`,
    brokers,
    retry: {
      retries: 5,
      initialRetryTime: 300,
      multiplier: 2,
      maxRetryTime: 30000,
    },
  };

  const mechanism = process.env.KAFKA_SASL_MECHANISM;

  // 1) AWS MSK IAM 인증 (oauthbearer + aws-msk-iam-sasl-signer-js)
  if (mechanism === 'aws-iam') {
    const region = process.env.AWS_REGION || 'ap-northeast-2';
    config.ssl = true;
    config.sasl = {
      mechanism: 'oauthbearer',
      oauthBearerProvider: async () => {
        const token = await generateAuthToken({ region });
        return { value: token.token };
      },
    };
    console.log(`✅ Kafka auth: aws-iam (region: ${region})`);
    return config;
  }

  // 2) SASL PLAIN (Confluent Cloud 등)
  const apiKey = process.env.KAFKA_API_KEY || process.env.KAFKA_SASL_USERNAME;
  const apiSecret = process.env.KAFKA_API_SECRET || process.env.KAFKA_SASL_PASSWORD;

  if (apiKey && apiSecret) {
    config.ssl = true;
    config.sasl = {
      mechanism: 'plain',
      username: apiKey,
      password: apiSecret,
    };
    console.log('✅ Kafka auth: sasl-plain');
    return config;
  }

  // 3) SSL만 또는 plaintext
  if (process.env.KAFKA_SSL === 'true') {
    config.ssl = true;
  }

  console.warn('⚠️  Kafka auth: none (plaintext)');
  return config;
}
