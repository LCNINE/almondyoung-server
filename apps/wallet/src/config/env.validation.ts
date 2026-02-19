import { z } from 'zod';

export const walletEnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  AUTH_SECRET: z.string().min(1),
  WALLET_HMAC_SHARED_SECRET: z.string().min(1).optional(),
  WALLET_IDEMPOTENCY_TTL_SECONDS: z.string().regex(/^\d+$/).optional(),
  WALLET_RECONCILE_BATCH_SIZE: z.string().regex(/^\d+$/).optional(),
  WALLET_RECONCILE_CRON: z.string().min(1).optional(),
  WALLET_EXPIRATION_BATCH_SIZE: z.string().regex(/^\d+$/).optional(),
  WALLET_EXPIRATION_CRON: z.string().min(1).optional(),
  WALLET_COMMAND_CONSUMER_GROUP_ID: z.string().min(1).optional(),
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
  JWT_ISSUER: z.string().optional(),
  JWT_AUDIENCE: z.string().optional(),
  PORT: z.string().regex(/^\d+$/).optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).optional(),
  SERVICE_NAME: z.string().optional(),
});

export type WalletEnvConfig = z.infer<typeof walletEnvSchema>;

export function validateWalletEnv(config: Record<string, unknown>) {
  const parsed = walletEnvSchema.safeParse(config);

  if (!parsed.success) {
    console.error('[Wallet] Invalid environment variables:');
    const errors = parsed.error.flatten().fieldErrors;
    Object.entries(errors).forEach(([key, messages]) => {
      console.error(`  - ${key}: ${messages?.join(', ')}`);
    });
    throw new Error('[Wallet] Invalid environment variables');
  }

  return parsed.data;
}
