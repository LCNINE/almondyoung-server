import { z } from 'zod';

export const outboxDemoEnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.string().regex(/^\d+$/).optional(),
  KAFKA_CLIENT_ID: z.string(),
  KAFKA_BROKERS: z.string(),
  KAFKA_API_KEY: z.string(),
  KAFKA_API_SECRET: z.string(),
  KAFKA_GROUP_ID: z.string().optional(),
});

export type OutboxDemoEnvConfig = z.infer<typeof outboxDemoEnvSchema>;

export function validateOutboxDemoEnv(config: Record<string, unknown>) {
  const parsed = outboxDemoEnvSchema.safeParse(config);

  if (!parsed.success) {
    console.error('❌ [Outbox Demo] Invalid environment variables:');
    const errors = parsed.error.flatten().fieldErrors;
    Object.entries(errors).forEach(([key, messages]) => {
      console.error(`  - ${key}: ${messages?.join(', ')}`);
    });
    throw new Error('[Outbox Demo] Invalid environment variables');
  }

  return parsed.data;
}
