import { z } from 'zod';

const optionalIsoTimestamp = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().datetime({ offset: true }).optional(),
);

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

    // Fulfillment hard-cutover workflow gate
    // 'legacy' 는 V1 출고 경로와 함께 Task 25 에서 제거됐다. 옛 값은 여기서 부팅을 막는다.
    FULFILLMENT_WORKFLOW_MODE: z.enum(['maintenance', 'v2']),
    FULFILLMENT_V2_CUTOVER_AT: optionalIsoTimestamp,

    // Elasticsearch (Catalog)
    ELASTICSEARCH_NODE: z.string().url().optional(),
    ELASTICSEARCH_USERNAME: z.string().optional(),
    ELASTICSEARCH_PASSWORD: z.string().optional(),
    FILE_SERVICE_URL: z.string().url().optional(),

    // 한진택배 (Fulfillment) — 계약 승인 전까지 미설정. 미설정 시 hanjin 발행은 503 반환.
    HANJIN_API_KEY: z.string().optional(),
    HANJIN_SENDER_NAME: z.string().optional(),
    HANJIN_TIMEOUT_MS: z.string().regex(/^\d+$/).optional(),

    // Waybill(한진 self-print) — 신규 계약 (플랜 3에서 구 HANJIN_* 제거)
    HANJIN_CLIENT_ID: z.string().optional(),
    HANJIN_SECRET_KEY: z.string().optional(),
    HANJIN_CONTRACT_NO: z.string().optional(),
    HANJIN_ORDER_BASE_URL: z.string().url().optional(),
    HANJIN_PRINT_BASE_URL: z.string().url().optional(),
    HANJIN_SENDER_ZIP: z.string().optional(),
    HANJIN_SENDER_BASE_ADDR: z.string().optional(),
    HANJIN_SENDER_DTL_ADDR: z.string().optional(),
    HANJIN_SENDER_TEL: z.string().optional(),
    HANJIN_BOX_TYPE: z.string().optional(),
    HANJIN_PAY_TYPE: z.string().optional(),

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
  })
  .superRefine((data, ctx) => {
    if (data.FULFILLMENT_WORKFLOW_MODE === 'v2' && !data.FULFILLMENT_V2_CUTOVER_AT) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'FULFILLMENT_V2_CUTOVER_AT is required when FULFILLMENT_WORKFLOW_MODE=v2',
        path: ['FULFILLMENT_V2_CUTOVER_AT'],
      });
    }
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
