import { z } from 'zod';

export const walletEnvSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),
  PORT: z.string().regex(/^\d+$/).optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).optional(),

  // HMS (Hankyung Merchant Service) Payment Provider
  SW_KEY: z.string(),
  CUST_KEY: z.string(),
  HMS_CUST_ID: z.string().optional(),

  // TOSS Payment Provider
  TOSS_SECRET_KEY: z.string().optional(),

  // Tax Invoice Configuration (HMS BNPL)
  SUPPLIER_BUSINESS_NUMBER: z.string().optional(),
  SUPPLIER_NAME: z.string().optional(),
  SUPPLIER_CEO_NAME: z.string().optional(),
  SUPPLIER_ADDRESS: z.string().optional(),
  SUPPLIER_EMAIL: z.string().email().optional(),
});

export type WalletEnvConfig = z.infer<typeof walletEnvSchema>;

export function validateWalletEnv(config: Record<string, unknown>) {
  const parsed = walletEnvSchema.safeParse(config);

  if (!parsed.success) {
    console.error('❌ [Wallet] Invalid environment variables:');
    const errors = parsed.error.flatten().fieldErrors;
    Object.entries(errors).forEach(([key, messages]) => {
      console.error(`  - ${key}: ${messages?.join(', ')}`);
    });
    throw new Error('[Wallet] Invalid environment variables');
  }

  return parsed.data;
}
