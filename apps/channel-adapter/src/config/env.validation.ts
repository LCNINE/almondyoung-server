import { z } from 'zod';

export const channelAdapterEnvSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),
  PORT: z.string().regex(/^\d+$/).optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).optional(),

  // Kafka Configuration
  KAFKA_CLIENT_ID_PREFIX: z.string(),
  KAFKA_BROKERS: z.string(),
  KAFKA_GROUP_ID: z.string(),
  KAFKA_API_KEY: z.string().optional(),
  KAFKA_API_SECRET: z.string().optional(),

  // Naver Smart Store API
  NAVER_API_ENDPOINT: z.string().url(),
  NAVER_CLIENT_ID: z.string(),
  NAVER_CLIENT_SECRET: z.string(),
  NAVER_ACCESS_TOKEN: z.string().optional(),
  NAVER_USE_MOCK_SERVER: z.string().optional(),

  // Coupang API
  COUPANG_API_ENDPOINT: z.string().url().optional(),
  COUPANG_ACCESS_KEY: z.string(),
  COUPANG_SECRET_KEY: z.string(),
  COUPANG_VENDOR_ID: z.string(),
  COUPANG_USE_MOCK_SERVER: z.string().optional(),

  // Channel Management
  ACTIVE_CHANNELS: z.string().optional(),
  ADAPTER_REQUIRED_CHANNELS: z.string().optional(),
  REQUIRED_CHANNELS: z.string().optional(),
  ADAPTER_MOCK_BASE_URL: z.string().url().optional(),

  // WMS Integration
  WMS_API_URL: z.string().url().optional(),
  WMS_TIMEOUT: z.string().regex(/^\d+$/).optional(),
  WMS_MAX_RETRIES: z.string().regex(/^\d+$/).optional(),

  // Medusa
  MEDUSA_API_URL: z.string().url(),
  MEDUSA_API_KEY: z.string(),
  MEDUSA_MEMBERSHIP_GROUP_ID: z.string().optional(),
  INBOX_MAX_CONCURRENT_HANDLERS: z.coerce.number().int().positive().optional(),
  INBOX_HANDLER_START_INTERVAL_MS: z.coerce.number().int().positive().optional(),
  INBOX_PROCESSING_LEASE_MS: z.coerce.number().int().positive().optional(),
  INBOX_SHUTDOWN_DRAIN_MS: z.coerce.number().int().nonnegative().optional(),
  INBOX_MAX_RETRIES: z.coerce.number().int().positive().optional(),

  // Firebase Membership Sync
  ALMOND_AUTH_URL: z.string().url().optional(),
  USER_SERVICE_URL: z.string().url().optional(),
  CHANNEL_ADAPTER_INTERNAL_KEY: z.string().optional(),
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
