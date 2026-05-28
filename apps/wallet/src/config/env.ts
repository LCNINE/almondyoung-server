import { z } from 'zod';

export const walletEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  WALLET_API_KEY: z.string().min(1),
  USER_JWT_SECRET: z.string().min(1),
  WALLET_IDEMPOTENCY_TTL_SECONDS: z.string().regex(/^\d+$/).optional(),
  WALLET_EXPIRATION_BATCH_SIZE: z.string().regex(/^\d+$/).optional(),
  WALLET_EXPIRATION_CRON: z.string().min(1).optional(),
  WALLET_OUTBOX_DISPATCH_CRON: z.string().min(1).optional(),
  WALLET_OUTBOX_BATCH_SIZE: z.string().regex(/^\d+$/).optional(),
  WALLET_OUTBOX_MAX_ATTEMPTS: z.string().regex(/^\d+$/).optional(),
  WALLET_OUTBOX_BASE_DELAY_MS: z.string().regex(/^\d+$/).optional(),
  WALLET_OUTBOX_MAX_DELAY_MS: z.string().regex(/^\d+$/).optional(),
  WALLET_OUTBOX_PROCESSING_TIMEOUT_SECONDS: z.string().regex(/^\d+$/).optional(),
  WALLET_OUTBOX_DEAD_LETTER_ENABLED: z
    .string()
    .regex(/^(1|0|true|false|yes|no|on|off)$/i)
    .optional(),
  PORT: z.string().regex(/^\d+$/).optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).optional(),
  SERVICE_NAME: z.string().optional(),
  // Comma-separated list of allowed CORS origins.
  // Supports exact origins and wildcard subdomains (e.g. "https://app.example.com,*.almondyoung-next.com")
  // Not required in development — all origins are allowed when NODE_ENV=development
  CORS_ORIGINS: z.string().optional(),
  TOSS_SECRET_KEY: z.string().min(1).optional(),
  TOSS_CLIENT_KEY: z.string().min(1).optional(),
  NICEPAY_CLIENT_KEY: z.string().min(1).optional(),
  NICEPAY_SECRET_KEY: z.string().min(1).optional(),
  // Kafka
  KAFKA_BROKERS: z.string().optional(),
  KAFKA_CLIENT_ID: z.string().optional(),
  KAFKA_GROUP_ID: z.string().optional(),
  // 효성 FMS (CMS)
  HYOSUNG_CMS_API_URL: z.string().url().optional(),
  HYOSUNG_CMS_ADD_URL: z.string().url().optional(),
  HYOSUNG_CMS_SW_KEY: z.string().min(1).optional(),
  HYOSUNG_CMS_CUST_KEY: z.string().min(1).optional(),
  HYOSUNG_CMS_CUST_ID: z.string().min(1).optional(),
  // Legacy deployment secret names. Prefer HYOSUNG_CMS_* for new environments.
  SW_KEY: z.string().min(1).optional(),
  CUST_KEY: z.string().min(1).optional(),
  CUST_ID: z.string().min(1).optional(),
});

export type WalletEnvConfig = z.infer<typeof walletEnvSchema>;

export function validateWalletEnv(config: Record<string, unknown>): WalletEnvConfig {
  const parsed = walletEnvSchema.safeParse(config);

  if (!parsed.success) {
    console.error('[Wallet] Invalid environment variables:');
    const errors = parsed.error.flatten().fieldErrors;
    for (const [key, messages] of Object.entries(errors)) {
      console.error(`  - ${key}: ${messages?.join(', ')}`);
    }
    throw new Error('[Wallet] Invalid environment variables');
  }

  return parsed.data;
}
