import { z } from 'zod';

export const walletEnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  AUTH_SECRET: z.string().min(1),
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
