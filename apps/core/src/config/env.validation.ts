import { z } from 'zod';

export const almondyoungEnvSchema = z
  .object({
    // Server
    PORT: z.string().regex(/^\d+$/).optional(),
    NODE_ENV: z.string().optional(),

    // Database
    DATABASE_URL: z.string().url(),

    // Auth — dual-mode: AUTH_SECRET (HS256 legacy) 또는 OIDC_ISSUER_URL (RS256/OIDC), 둘 중 하나 필수.
    AUTH_SECRET: z.string().min(1).optional(),
    OIDC_ISSUER_URL: z.string().url().optional(),
    ALLOWED_AUDIENCES: z.string().optional(),
    JWT_ISSUER: z.string().optional(),
    JWT_AUDIENCE: z.string().optional(),

    // Kafka
    KAFKA_CLIENT_ID_PREFIX: z.string().optional(),
    KAFKA_BROKERS: z.string().min(1),
    KAFKA_GROUP_ID: z.string().optional(),
    KAFKA_API_KEY: z.string().optional(),
    KAFKA_API_SECRET: z.string().optional(),

    // Elasticsearch (Catalog)
    ELASTICSEARCH_NODE: z.string().url().optional(),
    ELASTICSEARCH_USERNAME: z.string().optional(),
    ELASTICSEARCH_PASSWORD: z.string().optional(),
    FILE_SERVICE_URL: z.string().url().optional(),

    // Goodsflow (Fulfillment)
    GOODSFLOW_API_URL: z.string().url().optional(),
    GOODSFLOW_API_KEY: z.string().optional(),
    GOODSFLOW_CENTER_CODE: z.string().optional(),

    // Wallet 서비스 (취소 후 자동 환불 연결)
    // 미설정 시 환불은 manual_pending 상태로 기록되며 운영자가 수동 처리한다.
    WALLET_BASE_URL: z.string().url().optional(),
    WALLET_API_KEY: z.string().min(1).optional(),

    // OpenTelemetry
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
    OTEL_SERVICE_NAME: z.string().optional(),
  })
  .refine((data) => !!data.AUTH_SECRET || !!data.OIDC_ISSUER_URL, {
    message: 'Either AUTH_SECRET (HS256) or OIDC_ISSUER_URL (RS256) must be set',
    path: ['AUTH_SECRET'],
  });

export type AlmondyoungEnvConfig = z.infer<typeof almondyoungEnvSchema>;

export function validateAlmondyoungEnv(config: Record<string, unknown>) {
  const parsed = almondyoungEnvSchema.safeParse(config);

  if (!parsed.success) {
    console.error('❌ [Almondyoung Server] Invalid environment variables:');
    const errors = parsed.error.flatten().fieldErrors;
    Object.entries(errors).forEach(([key, messages]) => {
      console.error(`  - ${key}: ${messages?.join(', ')}`);
    });
    throw new Error('[Almondyoung Server] Invalid environment variables');
  }

  return parsed.data;
}
