import { z } from 'zod';

export const outboxDemoEnvSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),
  PORT: z.string().regex(/^\d+$/).optional(),
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
