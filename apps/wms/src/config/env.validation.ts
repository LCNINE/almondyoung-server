import { z } from 'zod';

export const wmsEnvSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),
  PORT: z.string().regex(/^\d+$/),

  // Kafka Configuration
  KAFKA_CLIENT_ID_PREFIX: z.string(),
  KAFKA_BROKERS: z.string(),
  KAFKA_GROUP_ID: z.string(),
  KAFKA_API_KEY: z.string().optional(),
  KAFKA_API_SECRET: z.string().optional(),

  // PIM Integration
  PIM_SYNC_ENABLED: z.string().optional(),
  PIM_BASE_URL: z.string().url().optional(),
  PIM_API_KEY: z.string().optional(),

  // Goodsflow Delivery Provider
  GOODSFLOW_API_URL: z.string().url().optional(),
  GOODSFLOW_API_KEY: z.string().optional(),
  GOODSFLOW_CENTER_CODE: z.string().optional(),

  // Testing
  TEST_DEBUG: z.string().optional(),
});

export type WmsEnvConfig = z.infer<typeof wmsEnvSchema>;

export function validateWmsEnv(config: Record<string, unknown>) {
  const parsed = wmsEnvSchema.safeParse(config);

  if (!parsed.success) {
    console.error('❌ [WMS] Invalid environment variables:');
    const errors = parsed.error.flatten().fieldErrors;
    Object.entries(errors).forEach(([key, messages]) => {
      console.error(`  - ${key}: ${messages?.join(', ')}`);
    });
    throw new Error('[WMS] Invalid environment variables');
  }

  return parsed.data;
}
