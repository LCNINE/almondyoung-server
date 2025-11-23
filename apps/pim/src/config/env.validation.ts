import { z } from 'zod';

export const pimEnvSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),

  // Server Configuration
  PIM_SERVICE_PORT: z.string().regex(/^\d+$/).optional(),

  // Base URL for image service
  BASE_URL: z.string().url().optional(),

  // Elasticsearch Configuration
  ELASTICSEARCH_NODE: z.string().url(),
  ELASTICSEARCH_USERNAME: z.string().optional(),
  ELASTICSEARCH_PASSWORD: z.string().optional(),
});

export type PimEnvConfig = z.infer<typeof pimEnvSchema>;

export function validatePimEnv(config: Record<string, unknown>) {
  const parsed = pimEnvSchema.safeParse(config);

  if (!parsed.success) {
    console.error('❌ [PIM] Invalid environment variables:');
    const errors = parsed.error.flatten().fieldErrors;
    Object.entries(errors).forEach(([key, messages]) => {
      console.error(`  - ${key}: ${messages?.join(', ')}`);
    });
    throw new Error('[PIM] Invalid environment variables');
  }

  return parsed.data;
}
