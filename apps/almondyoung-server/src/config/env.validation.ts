import { z } from 'zod';

export const almondyoungEnvSchema = z.object({
  // Server Configuration
  PORT: z.string().regex(/^\d+$/).optional(),
});

export type AlmondyoungEnvConfig = z.infer<typeof almondyoungEnvSchema>;

export function validateAlmondyoungEnv(config: Record<string, unknown>) {
  const parsed = almondyoungEnvSchema.safeParse(config);

  if (!parsed.success) {
    console.error('❌ [Almondyoung Server] Invalid environment variables:');
    const errors = parsed.error.flatten().fieldErrors;
    Object.entries(errors).forEach(([key, messages]) => {
      console.error(`  - ${key}: ${messages?.join(', ')}`);
    });
    throw new Error('[Almondyoung Server] Invalid environment variables');
  }

  return parsed.data;
}
