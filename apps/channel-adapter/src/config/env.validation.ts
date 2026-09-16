import { z } from 'zod';
import { hasAnyDemoSetting, isSafeDemoMode } from '../demo/demo-mode';

export const channelAdapterEnvSchema = z
  .object({
    // Database
    DATABASE_URL: z.string().url(),
    PORT: z.string().regex(/^\d+$/).optional(),
    NODE_ENV: z.enum(['development', 'production', 'test']).optional(),
    APP_STAGE: z.string().optional(),
    DEMO_CONSOLE_ENABLED: z.enum(['true', 'false']).optional(),
    EXTERNAL_INTEGRATIONS_MODE: z.enum(['real', 'mock']).optional(),

    // 전역 JwtAuthGuard/AdminRealmGuard 용 (dual-mode). 둘 중 하나는 필수인데, 그 강제는
    // AuthorizationModule 의 AUTH_CONFIG 팩토리가 이미 한다 — 검증을 두 곳에 두지 않는다.
    AUTH_SECRET: z.string().min(1).optional(),
    OIDC_ISSUER_URL: z.string().url().optional(),
    ALLOWED_AUDIENCES: z.string().optional(),
    JWT_ISSUER: z.string().optional(),
    JWT_AUDIENCE: z.string().optional(),

    // Kafka Configuration
    KAFKA_CLIENT_ID_PREFIX: z.string(),
    KAFKA_BROKERS: z.string(),
    KAFKA_GROUP_ID: z.string(),
    KAFKA_API_KEY: z.string().optional(),
    KAFKA_API_SECRET: z.string().optional(),

    // Naver Smart Store API
    NAVER_API_ENDPOINT: z.string().url().optional(),
    NAVER_CLIENT_ID: z.string().optional(),
    NAVER_CLIENT_SECRET: z.string().optional(),
    NAVER_ACCESS_TOKEN: z.string().optional(),
    NAVER_USE_MOCK_SERVER: z.string().optional(),

    // Coupang API
    COUPANG_API_ENDPOINT: z.string().url().optional(),
    COUPANG_ACCESS_KEY: z.string().optional(),
    COUPANG_SECRET_KEY: z.string().optional(),
    COUPANG_VENDOR_ID: z.string().optional(),
    COUPANG_USE_MOCK_SERVER: z.string().optional(),

    // Channel Management
    // ACTIVE_CHANNELS / ADAPTER_REQUIRED_CHANNELS / REQUIRED_CHANNELS 는 소비자 0곳인 채로 선언만
    // 남아 있어 #654 에서 제거했다. 채널 활성화는 Core 의 `sales_channels.is_active` 가 갖는다 (ADR-0031).
    ADAPTER_MOCK_BASE_URL: z.string().url().optional(),

    // WMS Integration
    WMS_API_URL: z.string().url().optional(),
    WMS_TIMEOUT: z.string().regex(/^\d+$/).optional(),
    WMS_MAX_RETRIES: z.string().regex(/^\d+$/).optional(),

    // Medusa
    MEDUSA_API_URL: z.string().url().optional(),
    MEDUSA_API_KEY: z.string().optional(),
    MEDUSA_MEMBERSHIP_GROUP_ID: z.string().optional(),
    INBOX_MAX_CONCURRENT_HANDLERS: z.coerce.number().int().positive().optional(),
    INBOX_HANDLER_START_INTERVAL_MS: z.coerce.number().int().positive().optional(),
    INBOX_PROCESSING_LEASE_MS: z.coerce.number().int().positive().optional(),
    INBOX_SHUTDOWN_DRAIN_MS: z.coerce.number().int().nonnegative().optional(),
    INBOX_MAX_RETRIES: z.coerce.number().int().positive().optional(),
    INBOX_SLOW_MAX_RETRIES: z.coerce.number().int().positive().optional(),
    DEFERRED_REVALIDATE_FLUSH_MS: z.coerce.number().int().min(1000).optional(),
    // 0 이면 조상 재보장 메모를 끈다 (킬스위치).
    CATEGORY_ANCESTOR_MEMO_MAX_ENTRIES: z.coerce.number().int().nonnegative().optional(),

    // Firebase Membership Sync
    ALMOND_AUTH_URL: z.string().url().optional(),
    USER_SERVICE_URL: z.string().url().optional(),
    CHANNEL_ADAPTER_INTERNAL_KEY: z.string().optional(),
    // core 의 서버 간 내부 라우트를 부를 때 싣는 키. 없으면 수집 게이트가 활성 판매채널을 조회하지
    // 못하고, 게이트는 fail-closed 라 폴링이 통째로 멈춘다 (#654).
    CORE_INTERNAL_KEY: z.string().optional(),
  })
  .superRefine((config, ctx) => {
    if (hasAnyDemoSetting(config) && !isSafeDemoMode(config)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['APP_STAGE'],
        message: 'demo requires APP_STAGE=demo, DEMO_CONSOLE_ENABLED=true, and EXTERNAL_INTEGRATIONS_MODE=mock',
      });
      return;
    }

    if (!isSafeDemoMode(config)) {
      for (const key of [
        'NAVER_API_ENDPOINT',
        'NAVER_CLIENT_ID',
        'NAVER_CLIENT_SECRET',
        'COUPANG_ACCESS_KEY',
        'COUPANG_SECRET_KEY',
        'COUPANG_VENDOR_ID',
        'MEDUSA_API_URL',
        'MEDUSA_API_KEY',
      ] as const) {
        if (!config[key]) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `${key} is required` });
        }
      }
    }
  });

export type ChannelAdapterEnvConfig = z.infer<typeof channelAdapterEnvSchema>;

export function validateChannelAdapterEnv(config: Record<string, unknown>) {
  const parsed = channelAdapterEnvSchema.safeParse(config);

  if (!parsed.success) {
    console.error('❌ [Channel Adapter] Invalid environment variables:');
    const errors = parsed.error.flatten().fieldErrors;
    Object.entries(errors).forEach(([key, messages]) => {
      console.error(`  - ${key}: ${messages?.join(', ')}`);
    });
    throw new Error('[Channel Adapter] Invalid environment variables');
  }

  return parsed.data;
}
