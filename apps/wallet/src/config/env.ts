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
  // Comma-separated list of allowed CORS origins (e.g. "https://app.example.com,https://admin.example.com")
  // Not required in development — all origins are allowed when NODE_ENV=development
  WALLET_CORS_ORIGINS: z.string().optional(),
  TOSS_SECRET_KEY: z.string().min(1).optional(),
  TOSS_CLIENT_KEY: z.string().min(1).optional(),
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
